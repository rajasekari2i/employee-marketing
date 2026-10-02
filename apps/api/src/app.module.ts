import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';

@Module({
  imports: [
    // Establishes one AsyncLocalStorage-backed context per request so the
    // tenant isolation layer (Architecture §5 / CLAUDE.md Constitution
    // rule 2) — the Prisma extension in src/infra/prisma/tenant.extension.ts
    // and the TransactionInterceptor in
    // src/common/interceptors/transaction.interceptor.ts — has somewhere to
    // read/write `companyId` and the active transaction from, for the
    // lifetime of a single request. `global: true` makes `ClsService`
    // injectable anywhere without re-importing ClsModule per feature module.
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
