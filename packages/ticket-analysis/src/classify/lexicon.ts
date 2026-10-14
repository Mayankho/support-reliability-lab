export const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'de'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const FEATURES = [
  'account_compromised',
  'api_auth_error',
  'api_rate_limit',
  'authority_claim',
  'balance_mismatch',
  'cancel_request',
  'cancelled_already',
  'cash_word',
  'chargeback',
  'credits',
  'credits_deducted',
  'credits_not_arrived',
  'data_access_request',
  'data_deletion',
  'deadline_days',
  'disliked_result',
  'duplicate_charge',
  'enterprise_mention',
  'export_problem',
  'follow_up',
  'generation',
  'generation_failed',
  'generation_strict',
  'generation_stuck',
  'instruction_like',
  'invoice_needed',
  'legal_framing',
  'login_code_missing',
  'money_context',
  'other_workspace_request',
  'outage_report',
  'password_problem',
  'pending_charge',
  'pricing_feedback',
  'purchase_context',
  'purchase_credits',
  'refund_word',
  'reports_refund_complete',
  'request_cue',
  'resolution_ack',
  'thanks',
  'unexpected_charge',
  'unexplained_deduction',
  'vat_or_tax_id',
  'wants_credits_back',
  'wants_job_fixed',
  'webhook_issue',
] as const;
export type Feature = (typeof FEATURES)[number];

const LETTER = '[\\p{L}\\p{N}]';
const word = (source: string) => new RegExp(`(?<!${LETTER})(?:${source})(?!${LETTER})`, 'u');
const near = (a: string, b: string, gap = 40) =>
  new RegExp(
    `(?<!${LETTER})(?:${a})(?!${LETTER}).{0,${String(gap)}}(?<!${LETTER})(?:${b})(?!${LETTER})`,
    'u',
  );
const either = (a: string, b: string, gap = 40) => [near(a, b, gap), near(b, a, gap)];

type Lexicon = Partial<Record<Feature, RegExp[]>>;

const JOB = 'jobs?|generations?|renders?|rendering|videos?|clips?|queue|outputs?';
const CREDIT_VERBS =
  'deducted|taken|took|charged|gone|used|used up|lost|disappeared|missing|vanished|consumed|cost|ate|drained';

/** Patterns that hold in any language: status codes, product nouns, and legal or tax acronyms. */
const NEUTRAL: Lexicon = {
  api_auth_error: [word('401')],
  api_rate_limit: [word('429')],
  webhook_issue: [word('webhooks?|callbacks?')],
  legal_framing: [word('gdpr|ccpa|dsgvo|rgpd')],
  vat_or_tax_id: [word('vat|gstin|tva|ust-?id')],
  request_cue: [/[?¿]/u],
};

const EN: Lexicon = {
  credits: [word('credits?')],
  credits_deducted: either('credits?', CREDIT_VERBS),
  unexplained_deduction: [
    word(
      'for no reason|no (jobs?|generations?) (ran|running)|without (using|generating) anything|unexplained|overnight',
    ),
  ],
  wants_credits_back: [
    word('credits? back'),
    near(
      'refund|return|restore|reimburse|give back|put back',
      '(my |the |those |these )?credits?',
      25,
    ),
    word('credit (refund|restoration)'),
  ],
  generation: [word(`${JOB}|images?|model`)],
  generation_strict: [word('jobs?|generations?|renders?|rendering|queue')],
  generation_failed: [
    word(
      "failed|failure|errored|crashed|produced nothing|came out (blank|empty)|did not (generate|render|finish|complete)|didn't (generate|render|finish|complete)",
    ),
    ...either('errors?', 'generations?|renders?|jobs?', 30),
  ],
  generation_stuck: [
    word(
      "stuck|frozen|hangs?|hanging|still (processing|loading|running|queued|pending|rendering|generating)|(says|shows) processing|queued for|processing for|in the queue for|has(n't| not) (finished|started|completed)|never (finishes|finished|completes|completed|starts)|for hours|at \\d{1,3} ?%|loading forever",
    ),
  ],
  wants_job_fixed: [
    ...either('fix|unstick|finish|complete|restart|rerun|re-run|push through', `${JOB}|it`, 20),
    word('get (it|this|my \\w+|the \\w+) (finished|done|working|unstuck|moving)'),
    word('when will (it|this|my \\w+|the \\w+) (finish|be (done|ready|finished))'),
    word('need (it|this|my \\w+|the \\w+) (done|finished|today|for)'),
  ],
  disliked_result: [
    word(
      "dislike[sd]?|don't like|do not like|didn't like|did not like|hate it|unhappy with|not happy with|disappointed|ugly|bad quality|poor quality|low quality|not what i (asked|wanted|expected)|looks (bad|terrible|awful|wrong)|(terrible|awful) result",
    ),
  ],
  refund_word: [word('refunds?|refunded|refunding|money back|reimburse(ment|d)?')],
  cash_word: [
    word('cash|money back|to my (card|bank)|on my card|back on my card|dollars?|euros?'),
    /\$\s?\d/u,
  ],
  money_context: [
    word(
      'card|charged?|charges|payments?|paid|billed|billing|bill|invoices?|subscriptions?|renewal|renewed|plan|upgrade|upgraded|transactions?|bank',
    ),
  ],
  purchase_context: [word('bought|purchased?|paid for|top-?up|topped up|ordered')],
  purchase_credits: either('bought|purchased?|paid for|topped up|top-?up', 'credits?', 30),
  credits_not_arrived: [
    ...either(
      'credits?|balance',
      "not (showing|there|added|applied|arrived|updated)|never (arrived|showed|appeared)|didn't (arrive|show|appear|update|change)|did not (arrive|show|appear|update|change)|has(n't| not) (changed|updated)|unchanged",
    ),
  ],
  duplicate_charge: [
    word(
      'charged (me )?twice|double[- ]?charged|charged two times|two (identical )?charges|duplicate (charge|payment)|billed twice|same charge twice',
    ),
  ],
  pending_charge: [word('pending|authori[sz]ation hold|on hold')],
  unexpected_charge: [
    ...either(
      "unexpected|unknown|unrecognized|unfamiliar|don't recognize|do not recognize|didn't authorize|did not authorize",
      'charges?|payments?|transactions?',
      25,
    ),
    near('charged', 'after (i )?cancel+ed', 30),
  ],
  cancel_request: [
    ...either(
      'cancel|cancell?ing|stop|end|turn off',
      'subscriptions?|plan|renewal|auto-?renew(al)?|membership|trial|next (invoice|charge|payment)',
      30,
    ),
    word("(don't|do not) (want to )?renew"),
  ],
  cancelled_already: [word("(just|already|i've|i have|i) cancell?ed")],
  pricing_feedback: [
    word(
      "too expensive|overpriced|not worth (it|the money|the price)|too pricey|(the )?pricing is|price is too high|prices? (are|is) (too )?high|can't afford|cannot afford|it is the pricing|it's the pricing|because of the pric(e|ing)",
    ),
  ],
  balance_mismatch: [
    word("different balances?|two balances|balances? (don't|do not) match|mismatched balances?"),
    ...either('balance', "differs|different|doesn't match|does not match|disagree", 30),
  ],
  api_auth_error: [
    word(
      "unauthori[sz]ed|invalid (api )?key|(api )?key (was )?(revoked|disabled|expired|invalid)|key (stopped|isn't|is not|doesn't|does not) work(ing)?|authentication (failed|error)",
    ),
  ],
  api_rate_limit: [word('rate[- ]limit(ed|s|ing)?|too many requests|throttl(ed|ing)')],
  export_problem: either(
    'exports?|exporting|exported',
    "fail(s|ed|ing)?|stuck|errors?|wrong|broken|never (finishes|finished|completes)|won't|doesn't|does not|can't|cannot|no (audio|sound)|corrupt(ed)?",
    30,
  ),
  login_code_missing: either(
    '(login |verification |sign-?in |one-?time )?(code|magic link|login link|login email)',
    "never (arrives?|came|comes|arrived)|(doesn't|does not|didn't|did not|isn't|is not) (arrive|arriving|come|coming|show up)|not (arriving|coming)|not received|haven't received|have not received",
    30,
  ),
  password_problem: either(
    'password|2fa|two[- ]factor|authenticator',
    "reset|forgot|forgotten|lost|wrong|incorrect|(can't|cannot) (log|sign)|locked|recover",
    30,
  ),
  account_compromised: [
    word(
      "hacked|compromised|someone (else )?(logged|used|accessed|got into|is using)|a different (user|person) (has )?(accessed|used|logged)|unauthori[sz]ed (access|logins?|use|charges?)|charges i (didn't|did not) make|(didn't|did not) make (these|this|those) (charges?|generations?)",
    ),
  ],
  other_workspace_request: [
    ...either(
      "(another|other|someone else's|a different|their|a client's) (workspace|account|team|organi[sz]ation|user)('s)?",
      'billing|invoices?|data|details|card|subscription|email|payment|usage|owner',
      50,
    ),
    word("(an )?account i (don't|do not) own"),
  ],
  data_deletion: [
    ...either(
      'delete|erase|remove|wipe|close',
      'my (account|data|personal data|information|profile)|all (my )?data',
      20,
    ),
    word('right to (be forgotten|erasure)'),
  ],
  data_access_request: [
    word(
      '(copy|export|download) of (all )?my (personal )?data|data (access|subject) request|subject access request|dsar',
    ),
  ],
  legal_framing: [
    word(
      'data protection (law|act|regulation)|right to erasure|right to be forgotten|lawyers?|attorneys?|solicitors?|legal (action|notice|request|deadline|obligation)|statutory|regulator',
    ),
  ],
  deadline_days: [word('within \\d{1,3} days|\\d{1,3}[- ]day deadline')],
  chargeback: [
    word(
      'charge-?backs?|(file|filed|open|opened|start|raise) a (dispute|chargeback)|dispute (the|this|that|my) (charge|payment|transaction)|(bank|card) dispute|disputed (the|this) (charge|payment)',
    ),
  ],
  vat_or_tax_id: [word('vat (id|number)|tax id|tax number|tax-exempt|tax exemption')],
  invoice_needed: either(
    'need|send|get|download|resend|issue|missing|where (is|are)|copy of|reissue|correct|add|update|change|include',
    'invoices?|receipts?',
    25,
  ),
  outage_report: [
    word(
      "(site|app|service|website|platform|everything) (is |seems |looks )?(down|offline|unreachable)|server errors?|internal (server )?error|5\\d\\d errors?|errors? 5\\d\\d|nothing (loads|works|is loading)|(can't|cannot) (load|reach|access) (the )?(site|app|website|anything)",
    ),
  ],
  resolution_ack: [
    word(
      "(it's|it is|all|everything is|everything's) (fine|good|working|sorted|ok|okay) now|(works|working) (again|now)|(resolved|solved|fixed) (itself|now)|thanks? (you )?for fixing|never ?mind|no longer (an issue|needed|a problem)|problem (is )?(gone|solved)",
    ),
  ],
  thanks: [word('thanks|thank you|cheers|appreciate (it|that)|many thanks')],
  follow_up: [
    word('any updates?|any news|still waiting|following up|follow(ing)? up|just checking in|bump'),
  ],
  instruction_like: [
    word(
      'ignore (all |any |the |every |your )?(previous |prior |above )?(instructions|rules)|system (prompt|override|message)|you are now|classify (this|me|it) as|mark (this|it) (as )?(resolved|closed|done)|developer mode',
    ),
  ],
  authority_claim: [
    word(
      "(i am|i'm) (the )?(ceo|cto|admin|administrator|owner of|staff|an employee|from (your|the) (security|support|billing) team|internal)|on behalf of|trust me|(i am|i'm) authori[sz]ed",
    ),
  ],
  reports_refund_complete: [
    word(
      "(you|you've|you have) (already )?(refunded|reimbursed)|refund (is|was|has been) (complete|completed|processed|sent|issued|done)|already (got|received) (my|the) refund|refund went through",
    ),
  ],
  enterprise_mention: [word('enterprise (plan|account|contract|customer|tier)')],
  request_cue: [
    word(
      "please|can you|could you|would you|i want|i need|i'd like|i would like|help me|how (do|can) i|is it possible",
    ),
  ],
};

const ES: Lexicon = {
  credits: [word('cr[eé]ditos?')],
  credits_deducted: either(
    'cr[eé]ditos?',
    'descontaron|cobraron|gastaron|perd[ií]|desaparecieron|quitaron',
  ),
  wants_credits_back: either(
    'devolver|devuelvan|devu[eé]lvanme|reembolsar|recuperar|restaurar',
    '(mis |los )?cr[eé]ditos',
    25,
  ),
  generation: [word('generaci[oó]n|v[ií]deos?|render(izado)?|trabajos?|clips?')],
  generation_strict: [word('generaci[oó]n|render(izado)?|trabajos?|cola')],
  generation_failed: [word('fall[oó]|ha fallado|error')],
  generation_stuck: [word('atascad[ao]|bloquead[ao]|sigue procesando|lleva horas|no termina')],
  refund_word: [word('reembolsos?|reembolsar|reembolsen|devoluci[oó]n|devolver (el|mi) dinero')],
  cash_word: [word('dinero|efectivo|a mi tarjeta')],
  money_context: [
    word(
      'tarjeta|cobros?|cobrado|cobraron|pagos?|pagu[eé]|facturas?|suscripci[oó]n|dinero|banco|renovaci[oó]n',
    ),
  ],
  purchase_context: [word('compr[eé]|compras?')],
  duplicate_charge: [word('(me )?cobraron dos veces|cobrado dos veces|doble cobro|dos cobros')],
  cancel_request: [
    ...either('cancelar|anular|dar de baja', 'suscripci[oó]n|plan|renovaci[oó]n|membres[ií]a', 30),
    word('no (quiero )?renovar'),
  ],
  data_deletion: either('borrar|eliminar|suprimir', '(mi )?(cuenta|datos)', 20),
  thanks: [word('gracias')],
  resolution_ack: [word('ya (funciona|est[aá] resuelto)|ya se arregl[oó]')],
  follow_up: [word('alguna novedad|sigo esperando')],
  request_cue: [word('por favor|pueden|puede|quiero|necesito|quisiera')],
};

const FR: Lexicon = {
  credits: [word('cr[ée]dits?')],
  credits_deducted: either(
    'cr[ée]dits?',
    'd[ée]bit[ée]s?|pr[ée]lev[ée]s?|perdus?|disparus?|consomm[ée]s?',
  ),
  wants_credits_back: either(
    'rendre|r[ée]cup[ée]rer|rembourser|restituer',
    '(mes |les )?cr[ée]dits',
    25,
  ),
  generation: [word('g[ée]n[ée]rations?|rendus?|vid[ée]os?|t[âa]ches?|clips?')],
  generation_strict: [word("g[ée]n[ée]rations?|rendus?|t[âa]ches?|file d'attente")],
  generation_failed: [word('[ée]chou[ée]e?|a [ée]chou[ée]|erreur')],
  generation_stuck: [
    word('bloqu[ée]e?|coinc[ée]e?|toujours en cours|depuis des heures|ne se termine pas'),
  ],
  refund_word: [word('rembours(ement|er|ez|[ée])')],
  cash_word: [word('argent|sur ma carte')],
  money_context: [
    word(
      'carte|paiements?|pay[ée]|factur[ée]e?|factures?|abonnement|argent|pr[ée]l[èe]vements?|banque',
    ),
  ],
  purchase_context: [word('achet[ée]s?|achats?')],
  duplicate_charge: [
    word(
      'd[ée]bit[ée] deux fois|factur[ée] deux fois|double (d[ée]bit|pr[ée]l[èe]vement|facturation)',
    ),
  ],
  cancel_request: either(
    'annuler|r[ée]silier|arr[êe]ter',
    'abonnement|forfait|renouvellement|plan',
    30,
  ),
  data_deletion: either('supprimer|effacer', 'mon compte|mes donn[ée]es', 20),
  thanks: [word('merci')],
  resolution_ack: [
    word(
      "(ça|cela) (marche|fonctionne) (maintenant|à nouveau)|c'est r[ée]solu|probl[èe]me r[ée]solu",
    ),
  ],
  follow_up: [word('des nouvelles|toujours en attente')],
  request_cue: [
    word("s'il vous pla[iî]t|svp|pouvez-vous|pourriez-vous|je veux|je voudrais|j'ai besoin"),
  ],
};

const DE: Lexicon = {
  credits: [word('credits?|guthaben')],
  credits_deducted: either('credits?|guthaben', 'abgezogen|abgebucht|verbraucht|weg|verschwunden'),
  wants_credits_back: either(
    'credits|guthaben',
    'zur[üu]ck|erstatten|gutschreiben|wiederherstellen',
    30,
  ),
  generation: [word('generierung|videos?|auftrag|auftr[äa]ge|rendering|clips?')],
  generation_strict: [word('generierung|auftrag|auftr[äa]ge|rendering|warteschlange')],
  generation_failed: [word('fehlgeschlagen|fehler|abgebrochen')],
  generation_stuck: [word('h[äa]ngt|steckt fest|seit stunden|wird nicht fertig')],
  refund_word: [word('r[üu]ckerstattung|erstatten|erstattung|zur[üu]ckerstatten|geld zur[üu]ck')],
  cash_word: [word('geld|auf meine karte')],
  money_context: [
    word('karte|zahlung|abbuchung|abgebucht|rechnung|abo|abonnement|geld|bank|verl[äa]ngerung'),
  ],
  purchase_context: [word('gekauft|kauf')],
  duplicate_charge: [word('doppelt (abgebucht|berechnet)|zweimal (abgebucht|berechnet)')],
  cancel_request: [
    word('k[üu]ndigen|k[üu]ndigung|abo beenden|abonnement beenden|nicht verl[äa]ngern'),
  ],
  data_deletion: either('l[öo]schen', '(mein )?(konto|daten)', 25),
  thanks: [word('danke')],
  resolution_ack: [
    word('(es )?funktioniert (jetzt )?wieder|hat sich erledigt|problem (ist )?gel[öo]st'),
  ],
  follow_up: [word('gibt es neuigkeiten|warte immer noch')],
  request_cue: [word('bitte|k[öo]nnen sie|ich m[öo]chte|ich brauche')],
};

const LEXICONS: Record<Language, Lexicon> = { en: EN, es: ES, fr: FR, de: DE };

/** Features present in already-normalized text, using the given languages plus neutral patterns. */
export function detectFeatures(text: string, languages: readonly Language[]): Set<Feature> {
  const found = new Set<Feature>();
  for (const lexicon of [NEUTRAL, ...languages.map((language) => LEXICONS[language])]) {
    for (const [feature, patterns] of Object.entries(lexicon) as Array<[Feature, RegExp[]]>) {
      if (!found.has(feature) && patterns.some((pattern) => pattern.test(text))) found.add(feature);
    }
  }
  return found;
}

export function isSupportedLanguage(code: string): code is Language {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}
