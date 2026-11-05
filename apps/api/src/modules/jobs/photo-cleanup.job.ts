import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { FilesService } from '../files/files.service';

/**
 * Architecture §14's scheduled-job table, first entry to actually ship.
 *
 * The job body is deliberately a one-line delegation: §14 notes that when
 * the API scales out these move to BullMQ and "the job bodies are plain
 * services and do not change", which only holds if the work itself lives
 * in the domain service (here `FilesService`) and the schedule is the only
 * thing this class owns. The advisory lock that keeps two replicas from
 * double-running it lives with the work for the same reason — it has to be
 * in the same transaction as the sweep, not wrapped around the caller.
 *
 * 03:30 UTC matches §14's `photo-backup` slot, which is the right
 * neighbourhood for this: both are volume housekeeping, and running the
 * sweep first means the backup does not ship objects that are about to be
 * deleted. This is one of the jobs whose schedule is genuinely global
 * rather than company-local (§14's first column) — nothing about "an
 * upload nobody claimed in 24 hours" depends on a company's working day.
 */
@Injectable()
export class PhotoCleanupJob {
  private readonly logger = new Logger(PhotoCleanupJob.name);

  constructor(private readonly files: FilesService) {}

  @Cron('30 3 * * *', { name: 'sweep-abandoned-avatars' })
  async sweepAbandonedAvatars(): Promise<void> {
    try {
      const { skipped, deleted } = await this.files.sweepAbandonedAvatars();
      if (skipped) {
        // Another replica is already running it — the expected outcome on
        // one of the two instances that overlap during a deploy.
        this.logger.log(
          'Abandoned-avatar sweep skipped: another instance holds the lock.',
        );
        return;
      }
      this.logger.log(`Abandoned-avatar sweep removed ${deleted} file(s).`);
    } catch (error) {
      // A throw out of a @Cron handler is an unhandled rejection that can
      // take the process down, and a failed housekeeping pass is not worth
      // that — the next run picks up whatever this one left behind.
      this.logger.error(
        `Abandoned-avatar sweep failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
