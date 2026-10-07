import 'reflect-metadata';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

import { AppModule } from '../src/app.module';

/**
 * T074 / Architecture §9: boots the real `AppModule` (so route metadata for
 * every registered controller is genuinely resolved by Nest, not hand
 * maintained), builds the OpenAPI document, and writes it to
 * `docs/openapi.json`. Run via `pnpm --filter api generate:openapi`
 * whenever a controller's routes or request-body DTOs change — this is a
 * one-shot generation step, not something wired into `main.ts`'s own boot
 * path (no live `/docs` HTTP route is exposed; Architecture §9 only asks
 * for the file to exist, "so Claude Code and Metaswarm agents can read the
 * contract without running the server").
 *
 * Requires a reachable `DATABASE_URL` (same as running the API itself) —
 * booting `AppModule` instantiates every provider, including the ones that
 * open a Prisma connection.
 *
 * `cleanupOpenApiDoc` is required by nestjs-zod itself (not optional) to
 * get correct output for the `createZodDto(...)`-derived DTOs already used
 * as every `@Body()` type across the auth/companies/users/me/files
 * controllers — see that package's README "OpenAPI (Swagger) support"
 * section.
 *
 * Per-route response-shape annotations (`@ApiOkResponse`/`@ZodResponse`)
 * are deliberately out of scope here — T074 asks to "wire OpenAPI
 * generation", not to fully document every response/status code across
 * ~25 routes. Request bodies/params are documented because the DTOs
 * driving them already exist for validation; adding accurate response
 * types for every route would be new, separate work.
 */
async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('Field Sales & Beat Execution API')
    .setDescription(
      'Generated from the Zod schemas in packages/shared via nestjs-zod + ' +
        '@nestjs/swagger (Architecture §9). Request bodies are documented ' +
        'from the createZodDto-derived DTOs each controller already uses ' +
        'for validation; per-route response shapes are not yet annotated.',
    )
    .setVersion(process.env.npm_package_version ?? '0.0.1')
    .addBearerAuth()
    .build();

  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));

  const outPath = resolve(__dirname, '../../../docs/openapi.json');
  writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`Wrote ${outPath}`);

  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
