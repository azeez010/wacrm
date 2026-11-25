-- Partner program: let a referrer add the people they referred to their own CRM
-- (contact + tag + pipeline deal) and auto-move the deal to Won when the referee pays.

-- WhatsApp-first: collect the owner's phone at onboarding so referrals are usable contacts.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone text;

-- Per-partner routing: { unpaid: { tagId, pipelineId, stageId }, paid: { tagId }, autoWon: bool }
ALTER TABLE partners ADD COLUMN IF NOT EXISTS crm_config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- What was created in the referrer's CRM for this referral.
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS crm_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS crm_deal_id uuid REFERENCES deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_referrals_referred_account ON referrals (referred_account_id);
