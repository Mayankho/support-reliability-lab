import type { AccountContext } from '@srl/contracts';

export type PolicyTopic =
  | 'provenance'
  | 'security'
  | 'cancellation'
  | 'credit'
  | 'generation'
  | 'refund'
  | 'proration'
  | 'technical';

/**
 * Language features extracted from an untrusted customer message. They describe what the customer
 * says, never what is true; account facts come only from the trusted account context.
 */
export interface Signals {
  refundRequested: boolean;
  cashRefund: boolean;
  refundOfCredits: boolean;
  cancel: boolean;
  restorationRequested: boolean;
  generation: boolean;
  failureQuestion: boolean;
  deductionReported: boolean;
  ledgerMismatch: boolean;
  prolongedWait: boolean;
  proration: boolean;
  billingUnclear: boolean;
  vagueTransaction: boolean;
  policyQuestion: boolean;
  policyTopic: PolicyTopic | null;
  outage: boolean;
  statusUnknown: boolean;
  docsConflict: boolean;
  docsStale: boolean;
  deletion: boolean;
  ownershipChange: boolean;
  othersDataRequest: boolean;
  disclosureRequest: boolean;
  crossTenantRequest: boolean;
  compromise: boolean;
  accessRecovery: boolean;
  verificationBypass: boolean;
  authorityClaim: boolean;
  instructionOverride: boolean;
  dispute: boolean;
  billingObject: boolean;
  accountObject: boolean;
  planStatusQuestion: boolean;
}

export function normalize(message: string): string {
  return message
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02BC]/gu, "'")
    .replace(/[\u201C\u201D]/gu, '"')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

const has = (text: string, pattern: RegExp): boolean => pattern.test(text);

const REFUND = /\brefund\w*|\bmoney back\b|\bback (on|to) my card\b|\breimburs\w*/u;
const NEGATED_REFUND = /\b(do not|don't|dont|not|no|never|without)\b.{0,15}\brefund/u;
const PURCHASE = /\b(credit )?(bundle|purchase|purchased|bought)\b/u;
const CASH = /\bcash\b|\busd\b|\bdollars?\b|\b(on|to) my card\b|\bmoney back\b/u;
const REFUND_OF_CREDITS = /\brefund\w*\s+(the |my |these |those )?credits\b|\bcredits? back\b/u;
const CANCEL =
  /\bcancel\w*|\bstop (the |my )?(next|upcoming) (invoice|renewal|charge|bill)|\b(do not|don't|dont) (want to )?renew\b|\bauto-?renewal\b|\bstop (my )?renewal\b/u;
const RESTORATION =
  /\brestor\w*|\breturn (them|it|my credits|the credits)\b|\bfix (the|my) (balance|credits)\b|\bcredits? back\b|\bput (the |my )?credits back\b/u;
const GENERATION =
  /\brender\w*|\bgenerat\w*|\bjobs?\b|\bclips?\b|\bvideos?\b|\bqueue\b|\bmodel produced\b/u;
const FAILURE_QUESTION =
  /\b(has|did|is) (my |the )?(job|render|generation|clip|video)\b[^.?!]*\bfail/u;
const DEDUCTION =
  /\b(deducted|charged|took|cost|consumed|gone|used up)\b|\blost\b[^.?!]*\bcredits?\b/u;
const LEDGER_MISMATCH =
  /\bdisagree\w*|\bmismatch\w*|\bdoes(n't| not) match\b|\binconsistent\b|\bdon't line up\b/u;
const PROLONGED = /\bfor (hours|days)\b|\bforever\b|\bstuck\b|\bhours\b/u;
const PRORATION =
  /\bprorat\w*|\bupgrad\w*|\bpartial-month\b|\bmid-?year\b|\bwhich rate\b|\bseats?\b|\bapplied twice\b|\bannual (invoice|credit|term|subscription|upgrade)\b|\bbill looks wrong\b|\bmakes no sense\b/u;
const BILLING_UNCLEAR = /\bnot sure (which|what|when)\b|\b(don't|do not) know which\b|\bunsure\b/u;
const VAGUE_TRANSACTION = /\bguess\b|\bfor something\b|\bsome (charge|payment|purchase)\b/u;
const POLICY_QUESTION =
  /\b(what is|what's) the [a-z -]*polic(y|ies)\b|\bwhich polic(y|ies)\b|\bcite\b[^.?!]*\bpolic(y|ies)\b|\bwhat the (docs|documentation|article|articles|kb) says?\b|\bwhat would happen if\b|\bdifference between\b|\bnot the same as\b|\b(article|document|kb)\b[^.?!]* says to\b/u;
const OUTAGE =
  /\b(is|are|went) down\b|\btemporarily down\b|\boutage\b|\btiming out\b|\btimed out\b|\bunavailable\b|\boffline\b|\bfailed entirely\b|\bnot responding\b/u;
const STATUS_UNKNOWN = /\bstatus is unknown\b|\bunknown status\b|\bcan(not|'t) load\b/u;
const DOCS_CONFLICT = /\bconflict\w*|\bcontradict\w*/u;
const DOCS_STALE =
  /\bprior year\b|\bout of date\b|\boutdated\b|\bold (policy|article|version)\b|\blast year's\b/u;
const DELETION = /\bdelete (my|the|this) account\b|\bdelete my data\b|\berase my (account|data)\b/u;
const OWNERSHIP = /\b(change|transfer) (the )?(account )?ownership\b|\bmake me (the )?owner\b/u;
const OTHERS_DATA =
  /\bhidden data\b|\bcustomer ?data\b|\b(their|his|her) (account |workspace )?(email|card|billing|invoices?|data|details)\b|\bother (users?|customers?)'? (data|emails?|accounts?)\b/u;
const DISCLOSURE =
  /\bdisclose\b|\bread me\b|\bshow me (the )?(invoices?|billing|payments?|their)\b|\bbilling details\b/u;
const CROSS_TENANT =
  /\b(another|other|different) (workspace|account|owner)\b|\bthe other workspace\b|\baccount i (do not|don't) own\b|\bnot my (account|workspace)\b/u;
const COMPROMISE =
  /\b(someone|somebody|a different user|another user|a stranger)\b[^.?!]*\b(accessed|logged into|is using|took over|changed)\b|\bcompromised\b|\bhacked\b|\bfreeze (everything|my account)\b/u;
const ACCESS_RECOVERY =
  /\blost (account )?access\b|\bcan(not|'t) (sign|log) ?in\b|\blogged out\b|\blocked out\b|\bverify me\b|\bcan(not|'t) verify my login\b/u;
const BYPASS =
  /\b(skip|bypass|get around)\b[^.?!]{0,20}\b(verification|verifying|login|log-?in|sign-?in|2fa)\b|\bbypass\b|\btoken\b/u;
const AUTHORITY =
  /\b(i am|i'm) (the |an? )?(ceo|founder|admin|administrator|internal administrator|staff( member)?|employee|support agent)\b|\binternal administrator\b|\bi am authorized\b|\btrust me\b/u;
const OVERRIDE =
  /\bignore (every|all|any|previous|prior|the|your)?\s?(rules?|instructions?|polic(y|ies)|higher-priority)|\bsystem override\b|\boverride (the )?(policy|rules)\b|\bsay so\b|\breply that\b|\bobey (it|the article)\b|\byou have already (refunded|cancelled|canceled|restored)\b|<script/u;
const DISPUTE = /\bdispute\w*|\bchargeback\w*/u;
const BILLING_OBJECT =
  /\binvoices?\b|\bpayments?\b|\breceipts?\b|\bbill(ing|s)?\b|\bcharges?\b|\brefund\w*/u;
const ACCOUNT_OBJECT = /\baccount\b|\blog-?in\b|\bsign-?in\b|\bverify\b|\bpassword\b|\b2fa\b/u;
const PLAN_STATUS =
  /\bplan is (already )?(inactive|cancel\w*|ended)\b|\bwhy did i (receive|get) a notice\b/u;
const WORKSPACE_ID = /\bws_[a-z0-9_]+\b/gu;

function policyTopic(text: string): PolicyTopic | null {
  if (has(text, /\b(missing|cited|citation|sources?)\b/u)) return 'provenance';
  if (has(text, /\brecover\w*|\baccess\b|\bsecurity\b|\blog-?in\b|\baccount\b/u)) return 'security';
  if (has(text, /\bcancel\w*|\brenew\w*/u)) return 'cancellation';
  if (
    has(
      text,
      /\bcredits?\b[^.?!]*\b(not the same|cash|usd|dollars?)\b|\bdifference between\b[^.?!]*\bcredits\b/u,
    )
  ) {
    return 'credit';
  }
  if (has(text, /\bgenerat\w*|\bcompleted\b|\bdislik\w*|\bvideo\b|\brender\w*/u))
    return 'generation';
  if (has(text, /\brefund\w*/u)) return 'refund';
  if (has(text, /\bprorat\w*/u)) return 'proration';
  if (has(text, /\boutage\b|\bstatus\b/u)) return 'technical';
  return null;
}

export function extractSignals(message: string, account: AccountContext): Signals {
  const text = normalize(message);
  const mentionsOtherWorkspace = [...text.matchAll(WORKSPACE_ID)].some(
    ([id]) => id !== account.actorWorkspaceId.toLowerCase(),
  );
  const purchaseReview = has(text, PURCHASE) && has(text, /\breview\b/u);
  const refundRequested =
    purchaseReview ||
    text.split(/[.;:!?]/u).some((clause) => has(clause, REFUND) && !has(clause, NEGATED_REFUND));

  return {
    refundRequested,
    cashRefund: has(text, CASH),
    refundOfCredits: has(text, REFUND_OF_CREDITS),
    cancel: has(text, CANCEL),
    restorationRequested: has(text, RESTORATION),
    generation: has(text, GENERATION),
    failureQuestion: has(text, FAILURE_QUESTION),
    deductionReported: has(text, DEDUCTION),
    ledgerMismatch: has(text, LEDGER_MISMATCH),
    prolongedWait: has(text, PROLONGED),
    proration: has(text, PRORATION),
    billingUnclear: has(text, BILLING_UNCLEAR),
    vagueTransaction: has(text, VAGUE_TRANSACTION),
    policyQuestion: has(text, POLICY_QUESTION),
    policyTopic: policyTopic(text),
    outage: has(text, OUTAGE),
    statusUnknown: has(text, STATUS_UNKNOWN),
    docsConflict: has(text, DOCS_CONFLICT),
    docsStale: has(text, DOCS_STALE),
    deletion: has(text, DELETION),
    ownershipChange: has(text, OWNERSHIP),
    othersDataRequest:
      has(text, OTHERS_DATA) || (has(text, /\bdisclose\b/u) && has(text, /\bhidden\b|\btheir\b/u)),
    disclosureRequest: has(text, DISCLOSURE),
    crossTenantRequest: has(text, CROSS_TENANT) || mentionsOtherWorkspace,
    compromise: has(text, COMPROMISE),
    accessRecovery: has(text, ACCESS_RECOVERY),
    verificationBypass: has(text, BYPASS),
    authorityClaim: has(text, AUTHORITY),
    instructionOverride: has(text, OVERRIDE),
    dispute: has(text, DISPUTE),
    billingObject: has(text, BILLING_OBJECT),
    accountObject: has(text, ACCOUNT_OBJECT),
    planStatusQuestion: has(text, PLAN_STATUS),
  };
}
