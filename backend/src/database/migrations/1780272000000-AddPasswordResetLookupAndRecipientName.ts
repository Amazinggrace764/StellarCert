import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordResetLookupAndRecipientName1780272000000 implements MigrationInterface {
  name = 'AddPasswordResetLookupAndRecipientName1780272000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordResetTokenHash" character varying',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_users_password_reset_token_hash" ON "users" ("passwordResetTokenHash")',
    );

    await queryRunner.query(
      'ALTER TABLE "certificates" ADD COLUMN IF NOT EXISTS "recipientName" character varying',
    );
    await queryRunner.query(
      `UPDATE "certificates"
       SET "recipientName" = COALESCE(NULLIF("metadata"->>'recipientName', ''), 'Unknown Recipient')
       WHERE "recipientName" IS NULL`,
    );
    await queryRunner.query(
      'ALTER TABLE "certificates" ALTER COLUMN "recipientName" SET NOT NULL',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_certificates_recipient_name" ON "certificates" ("recipientName")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_certificates_recipient_name"',
    );
    await queryRunner.query(
      'ALTER TABLE "certificates" DROP COLUMN IF EXISTS "recipientName"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_users_password_reset_token_hash"',
    );
    await queryRunner.query(
      'ALTER TABLE "users" DROP COLUMN IF EXISTS "passwordResetTokenHash"',
    );
  }
}
