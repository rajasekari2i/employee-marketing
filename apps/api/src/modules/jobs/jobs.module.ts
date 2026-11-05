import { Module } from '@nestjs/common';

import { FilesModule } from '../files/files.module';
import { PhotoCleanupJob } from './photo-cleanup.job';

/**
 * Home for Architecture §14's scheduled jobs. Only `PhotoCleanupJob` is
 * built so far; the rest of that table (`materialise-assignments`, the
 * beat reminders, `auto-close-beat-days`, `salary-draft`, `cleanup`,
 * `photo-backup`) lands here alongside it, each as a thin `@Cron` class
 * over work that lives in its own domain service.
 *
 * `ScheduleModule.forRoot()` is registered once in `app.module.ts`, not
 * here — it installs the global scheduler registry, so it belongs with the
 * other app-wide `forRoot` registrations rather than with the first module
 * that happens to need it.
 */
@Module({
  imports: [FilesModule],
  providers: [PhotoCleanupJob],
})
export class JobsModule {}
