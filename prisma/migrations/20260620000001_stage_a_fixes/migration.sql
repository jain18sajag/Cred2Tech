DO $$ BEGIN
    CREATE TYPE "DataPullType" AS ENUM ('GST', 'ITR', 'BANK', 'BUREAU');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "DataPullFlowType" AS ENUM ('GST_AUTH_LINK', 'GST_OTP', 'GST_PASSWORD', 'ITR_FORM', 'ITR_ANALYTICS', 'BANK_STATEMENT', 'BUREAU');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
