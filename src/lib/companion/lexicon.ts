import type { Trait } from "./traits";

/**
 * What the Companion listens for. Each cue is a plain pattern for the way people really write: Nigerian English,
 * Pidgin and the odd Yoruba phrase, "japa", "side hustle", "corper", "pikin". It runs in the browser with no network
 * and no assistant, so it works on a poor connection, for everyone, and every pick can be explained by pointing
 * at the words that caused it.
 *
 * Weights say how sure a phrase is:
 *   3.0  unmistakable ("I'm married", "lost my job", "I run a business")
 *   2.4  clear ("bank", "my husband", "promotion")
 *   1.6  suggestive ("shop", "plan", "career"): helps ranking, never fills an answer in by itself
 *
 * `fact` marks cues that state what is true now. They are skipped when the sentence says "not", "want to", "hope to"
 * and the like, so "I want to start a business" is a goal, not "has a business", and "not married" is not "married".
 */
export type Weighted = readonly [Trait, number];
export type Cue = { traits: readonly Weighted[]; re: RegExp; fact: boolean };

const STRONG = 3;
const CLEAR = 2.4;
const FAINT = 1.6;

const cue = (traits: Weighted | readonly Weighted[], re: RegExp, fact = false): Cue => ({
  traits: Array.isArray(traits[0]) ? (traits as readonly Weighted[]) : [traits as Weighted],
  re,
  fact,
});

/** "I am" in every way it is written. */
const IAM = String.raw`(?:i(?:'m| am)|we(?:'re| are)|am)`;
/** Doctors and surgeons are "consultants" too; those are not people who sell advice. */
const NOT_DOCTOR = String.raw`(?!\s+(?:doctor|physician|surgeon|paediatrician|pediatrician|radiologist|obstetrician|gynaecologist|anaesthetist|psychiatrist|neurologist|cardiologist))`;

export const CUES: readonly Cue[] = [
  // ---------------------------------------------------------------- how they work
  cue([["employed", STRONG], ["t_career", FAINT]], /\bi (?:currently |dey |de )?work (?:at|for|in|with) (?!myself|my own)(?:an? |the |one )?[a-z]+/, true),
  cue(["employed", CLEAR], /\b(?:my|our) (?:boss|office|employer|line manager|supervisor|workplace|colleagues|coworkers|co-workers)\b/, true),
  cue(["employed", CLEAR], /(?<!lost |lose |losing |left |quit |without |need a |find a |find my next |want a )\bmy job\b/, true),
  cue([["employed", CLEAR], ["t_leadership", CLEAR]], /\b(?:promoted|promotion)\b/),
  cue([["t_leadership", STRONG], ["employed", FAINT]], /\b(?:lead(?:ing)? a team|manage(?:s|d)? a team|team lead|head of (?:department|team|unit|sales|finance|operations)|supervis(?:e|ing) (?:a |my )?(?:team|staff)|leadership (?:role|position|skills?)|step(?:ping)? into (?:a )?leadership|lead(?:ing)? (?:better|others|people) at work)\b/),
  cue([["t_leadership", CLEAR], ["employed", CLEAR]], /\b(?:manager|supervisor|director|head of)\b/),
  cue([["employed", STRONG], ["f_law_public", CLEAR]], /\b(?:civil servant|public servant|federal ministry|state ministry|ministry of|local government|lga|public service)\b/, true),
  cue(["employed", FAINT], /\b(?:corporate|9 to 5|nine to five|salary|salaried|monthly pay|staff of|work(?:ing)? (?:long )?hours)\b/, true),

  cue([["self_employed", STRONG], ["t_business", CLEAR]], /\b(?:i|we) (?:run|own|started|founded|manage|have|am running|am building|are building|am growing) (?:a |my |my own |an |our |our own )?(?:small |little |growing |online |family |new )?(?:business|company|startup|start-up|shop|store|boutique|restaurant|salon|farm|brand|agency|school|firm|enterprise|venture)\b/, true),
  // "I run a small provisions shop": a few words may sit between "a" and the kind of business, but never a preposition,
  // so "I run a programme at my company" does not read as running one's own.
  cue([["self_employed", STRONG], ["t_business", CLEAR]], /\b(?:i|we) (?:run|own|started|founded|am running|are running) (?:a |my |my own |an |our |our own )(?:(?!(?:at|in|of|for|my|the|to|with|and|on|from|by) )[a-z'-]+ ){1,3}(?:business|company|startup|shop|store|boutique|restaurant|salon|farm|brand|agency|kiosk|stall|bakery|pharmacy|catering)\b/, true),
  cue([["self_employed", CLEAR], ["t_business", CLEAR]], /\b(?:i (?:dey|de) (?:do|run|sell|hustle)\b(?:\s+[a-z]+){0,4}|small[- ]small business|small business)/, true),
  cue([["self_employed", CLEAR + 0.4], ["t_business", CLEAR]], /\bmy (?:own )?(?:business|startup|start-up|shop|boutique|venture|brand|enterprise)\b/, true),
  // "My company" is as often the employer as one's own, so it is only a faint hint.
  cue([["self_employed", FAINT]], /\bmy company\b/, true),
  cue([["self_employed", CLEAR], ["t_business", CLEAR]], /\b(?:side hustle|my hustle|hustle)\b/, true),
  cue([["self_employed", STRONG], ["t_business", CLEAR]], /\b(?:self[- ]employed|entrepreneur|business owner|business man|business woman|businessman|businesswoman|co-?founder|founder of)\b/, true),
  cue([["self_employed", CLEAR], ["t_grow", CLEAR], ["t_business", CLEAR]], /\bmy (?:customers|sales|revenue|stock|inventory|staff|employees|workers|shop assistants?|apprentices?)\b|\bcash ?flow\b|\bprofit margins?\b/, true),
  cue([["consultant", STRONG], ["self_employed", CLEAR], ["t_clients", CLEAR]], /\bfreelanc(?:e|er|ing)\b/, true),
  cue([["consultant", STRONG], ["t_clients", CLEAR]], new RegExp(String.raw`${IAM} (?:an? )?(?:\w+ )?(?:consultant|adviser|advisor|coach|contractor)${NOT_DOCTOR}\b`), true),
  cue([["consultant", CLEAR], ["t_clients", CLEAR]], new RegExp(String.raw`\b(?:consulting|my advisory|my coaching)\b|\bconsultant${NOT_DOCTOR}\b`), true),
  cue([["t_launch", STRONG], ["t_business", CLEAR]], /\b(?:register(?:ed|ing)? (?:my |the |our )?business|cac registration|cac\b|business idea|idea for a business|formali[sz]e (?:my|the|our) business|turn my idea|go full[- ]time (?:in|on|with) (?:my|the))\b/),
  cue([["t_launch", STRONG], ["t_business", CLEAR]], /\b(?:start(?:ing)?|launch(?:ing)?|begin(?:ning)?|open(?:ing)?|build(?:ing)?|set(?:ting)? up) (?:a |my |my own |our |an )?(?:new )?(?:business|company|startup|start-up|brand|shop|venture|restaurant|salon|farm|school)\b/),
  cue([["t_grow", STRONG], ["t_business", CLEAR]], /\b(?:grow(?:ing)? (?:my|the|our)? ?(?:business|revenue|sales|company|brand|customers|customer base)|scal(?:e|ing) (?:up|my|the|our)|more customers|more sales|systemi[sz]e|put systems|tired of doing it alone|doing everything myself|do everything myself|doing it alone)\b/),
  cue(["t_business", CLEAR], /\b(?:business|entrepreneur(?:ship)?|startup|start-up|enterprise)\b/),

  cue([["between_jobs", STRONG], ["t_jobsearch", STRONG]], /\b(?:lost (?:my|his|her) job|losing my job|laid[- ]off|retrench(?:ed|ment)|downsiz(?:ed|ing)|made redundant|redundan(?:t|cy)|got sacked|was sacked|been sacked|been fired|got fired|let go from|jobless|unemployed|out of (?:a )?(?:work|job)|no job|without a job|between (?:jobs|roles|contracts)|looking for (?:a |another |new |my next )?(?:job|work|role|opportunit(?:y|ies))|searching for (?:a |another |new |my next )?(?:job|work|role)|job[- ]hunt(?:ing)?|job search|applying for jobs|applying for roles)\b/, true),
  cue([["between_jobs", CLEAR], ["t_jobsearch", CLEAR]], /\b(?:trusting god for (?:a |my |the )?(?:job|next|new)|waiting on god for (?:a |my |the )?(?:job|next|new)|believing god for (?:a |my |the )?(?:job|next|new)|next door|next chapter of my career|(?:just|recently) resigned|resigned from)\b/, true),
  cue(["employed", CLEAR], /\b(?:first job|first real job|new job|new role)\b|\bjust got (?:a |the )?job\b/, true),

  cue([["student", STRONG], ["t_study", CLEAR]], new RegExp(String.raw`${IAM} (?:an? )?(?:final year |first year |second year |third year |fourth year |postgraduate |post-graduate |masters? |phd |undergraduate |university |college |polytechnic |secondary school )?student\b`), true),
  cue([["student", STRONG], ["t_study", CLEAR]], /\b(?:final[- ]year|first[- ]year|second[- ]year|undergrad(?:uate)?|postgrad(?:uate)?|my (?:studies|lecturers?|lectures|hostel|campus|semester|cgpa|gpa|project defen[cs]e)|at (?:the )?university of|in (?:100|200|300|400|500) level)\b/, true),
  cue([["student", CLEAR], ["t_study", CLEAR]], /\bstudying(?! the (?:word|bible|scriptures))\b|\bstudy(?:ing)? (?:at|in|for) (?:the )?(?:university|college|degree|masters|exams?)\b/, true),
  cue([["t_exam", STRONG], ["t_study", CLEAR]], /\b(?:exams?|jamb|waec|neco|cgpa|grades|thesis|dissertation|defen[cs]e|ican|acca|cfa|mdcn|bar finals|professional exams?)\b/),
  cue(["t_study", FAINT], /\b(?:degree|assignments?|graduat(?:e|ion|ing)|school)\b/),
  cue([["nysc", STRONG]], /(?<!finished |completed |after |done with |ended |passed out of |before )\b(?:nysc|corp(?:s|er|ers)? members?|youth corps|corper|orientation camp|service year|ppa|passing[- ]out parade|serving in)\b/, true),
  cue([["homemaker", STRONG]], /\b(?:stay[- ]at[- ]home (?:mum|mom|mother|dad|father|parent|wife)|full[- ]time (?:mum|mom|mother|dad|father|parent|wife|home ?maker)|housewife|home ?maker|raising (?:my|our) (?:children|kids) full[- ]time|left my job to (?:raise|care|look after))\b/, true),
  cue([["retired", STRONG]], new RegExp(String.raw`\b(?:${IAM} retired|retired (?:from|teacher|nurse|civil|banker|army|officer|pastor|doctor|lecturer)|my pension|on pension|pensioner|retired)\b`), true),
  cue(["retired", FAINT], /\b(?:retirement|retiring|pension)\b/),

  // ---------------------------------------------------------------- the field
  cue(["f_finance", CLEAR], /\b(?:bank(?:er|ing|s)?|fintech|accountan(?:t|cy)|accounting|auditor|auditing|audit|insurance|investments?|finance|treasury|micro-?finance|stock ?broker|pension fund|tax advis|forex)\b/),
  cue(["f_tech", CLEAR], /\b(?:in tech|tech (?:worker|professional|job|role|career|sector|firm|person))\b/),
  cue(["f_tech", CLEAR], /\b(?:software|developer|programmer|coder|coding|data (?:analyst|scientist|engineer)|product manager|ux|ui designer|devops|cyber ?security|tech (?:company|startup|space|industry)|saas|app developer|web developer|machine learning|it (?:company|department|specialist|support)|fintech)\b/),
  cue(["f_health", CLEAR + 0.2], /\b(?:doctor|nurse|nursing|pharmac(?:ist|y)|hospital|clinic|midwife|physician|surgeon|radiograph(?:er|y)|physiotherap(?:ist|y)|lab scientist|dentist|health ?care|house officer|housemanship|registrar|medical (?:doctor|student|practitioner|officer|field))\b/),
  cue(["f_education", CLEAR + 0.2], /\b(?:teacher|teaching(?! hospital)|lecturer|school (?:owner|proprietor|principal|head)|tutor(?:ing)?|professor|educator|headmaster|headmistress|principal of|my (?:pupils|students))\b/),
  cue(["f_creative", CLEAR], /\b(?:music(?:ian)?|singer|song ?writer|producer|dj|artist|artiste|designer|graphic|film(?:maker|making)?|video ?(?:editor|grapher)|photograph(?:er|y)|writer|author|poet|fashion|tailor|seamstress|make-?up artist|content creator|creative|actor|actress|nollywood|painter|illustrat(?:or|ion))\b/),
  cue(["f_law_public", CLEAR], /\b(?:lawyer|barrister|advocate|solicitor|law firm|judge|magistrate|ministry|government|police|army|military|navy|customs|immigration officer|politic(?:s|ian)|councillor|nnpc|inec)\b/),
  cue(["f_engineering_trades", CLEAR], /(?<!software |data |network |devops |ml |ai )\bengineer\b|\b(?:engineering|construction|oil (?:and|&) gas|oil company|mechanic|electrician|architect|surveyor|plumber|welder|carpenter|builder|real estate|artisan|technician|power sector|telecoms?)\b/),
  cue(["f_agriculture_food", CLEAR], /\b(?:farm(?:er|ing)?|agric(?:ulture|ultural)?|agro|poultry|fish farm|catering|caterer|restaurant|chef|baker|bakery|food business|food vendor|livestock|cassava)\b/),
  cue(["f_ministry_ngo", CLEAR], /\b(?:pastor|reverend|church staff|full[- ]time ministry|missionar(?:y|ies)|missions?|ngo|charity|non-?profit|chaplain|evangelist)\b/),
  cue(["f_trade_retail", CLEAR], /\bsell(?:ing)? (?:provisions|clothes|shoes|foodstuff|phones|goods|products|items|wares|fabrics?|bags|wigs)\b/, true),
  cue(["f_trade_retail", CLEAR - 0.2], /\b(?:trader|trading|retail|import(?:er|ing)|export(?:er|ing)?|distribut(?:or|ion)|supply chain|wholesale|sales ?(?:person|rep|executive)|provisions|e-?commerce|online store|boutique)\b/),
  cue(["f_trade_retail", FAINT], /\b(?:market|shop|store|sales)\b/),

  // ---------------------------------------------------------------- home life
  cue(["single", STRONG], /\b(?:i(?:'m| am) single|still single|single (?:woman|man|lady|guy))\b/, true),
  cue(["single", FAINT + 0.2], /\b(?:unmarried|not married(?: yet)?|not yet married|haven't married|have not married|i(?:'m| am) not in a relationship)\b/, true),
  cue([["single", CLEAR], ["t_prep", CLEAR], ["t_marriage", CLEAR]], /\b(?:believing god for (?:a |my )?(?:husband|wife|spouse|partner|marriage)|waiting on god for (?:a |my )?(?:husband|wife|spouse|partner)|looking for (?:a )?(?:husband|wife|spouse)|want to (?:get )?married|hope to (?:get )?married)\b/),
  cue(["courting", CLEAR + 0.4], /\b(?:boyfriend|girlfriend|dating|courtship|courting|in a relationship|in a serious relationship|seeing someone)\b/, true),
  cue([["engaged", STRONG], ["t_prep", STRONG], ["t_marriage", CLEAR]], /\b(?:engaged|engagement|fianc(?:e|ee|é|ée)|(?:we(?:'re| are)|i(?:'m| am)) (?:getting|about to get) married|(?:my|our) wedding|wedding (?:in|on|is|date|plans?|preparations?)|traditional (?:wedding|marriage)|introduction (?:is|was|on|in|next))\b/),
  cue([["t_prep", CLEAR], ["t_marriage", CLEAR]], /\b(?:pre-?marital|marriage (?:course|counselling|counseling|class)|prepar(?:e|ing) (?:well )?for marriage|preparing for (?:our )?wedding)\b/),
  cue([["married", STRONG], ["t_marriage", CLEAR]], new RegExp(String.raw`\b(?:(?:${IAM}|been|happily|newly|recently|just|got|we got|i got) married|(?<!was |were |once |previously )married (?:with|to|for|man|woman|couple|life|people|mum|mom|dad|father|mother)|my (?:husband|wife|spouse|hubby)|oko mi|iyawo mi|my other half)\b`), true),
  cue([["married", STRONG]], /(?:^|[.!?]\s+)married\b/, true),
  cue([["married", STRONG], ["t_marriage", CLEAR]], new RegExp(String.raw`\b(?:${IAM} (?:an? |the )?(?:proud |happy |new )?(?:wife|husband)|(?:pastor|reverend|minister|bishop|deacon|doctor|lawyer|teacher|engineer)'?s (?:wife|husband))\b`), true),
  cue([["t_marriage", CLEAR]], /\b(?:marriage|husband|wife|spouse|hubby|couple|couples)\b/),

  cue([["c_expecting", STRONG], ["t_parenting", CLEAR]], /\b(?:pregnan(?:t|cy)|expecting (?:a |our |my )?(?:baby|child|first|second|third|twins)|baby on the way|new baby|(?:we|i)(?:'re| am| are) expecting|my wife is expecting)\b/, true),
  cue([["c_under_12", STRONG], ["c_some", CLEAR], ["t_parenting", CLEAR]], /\b(?:(?:small|young|little|tiny) (?:kids?|child(?:ren)?|ones|boys?|girls?|son|daughter|sons|daughters)|toddlers?|newborn|infant|nursery school|creche|crèche|primary[- ]school|pikin(?:s)?|babies|my baby|our baby|kindergarten|nappies|diapers|school run|bedtime stories)\b/, true),
  cue([["c_under_12", CLEAR], ["c_some", CLEAR], ["t_parenting", CLEAR]], /\b(?:son|daughter|child|kid|boy|girl|twins)s?(?: is| are|,)? (?:[1-9]|1[01]|one|two|three|four|five|six|seven|eight|nine|ten|eleven)(?: years?| yrs)? old\b|\b(?:[1-9]|1[01]|one|two|three|four|five|six|seven|eight|nine|ten|eleven)[- ]year[- ]old (?:son|daughter|child|kid|boy|girl)\b/, true),
  cue([["c_teens", STRONG], ["c_some", CLEAR], ["t_parenting", CLEAR]], /\b(?:teen(?:s|age|ager|agers)?|adolescen(?:t|ts|ce)|secondary school|high school|jss ?[123]|ss ?[123]|puberty|(?:son|daughter|child|kid)s?(?: is| are)? 1[2-9](?: years?)?(?: old)?)\b/, true),
  cue([["c_adult", STRONG], ["c_some", CLEAR]], /\b(?:grown[- ](?:up )?(?:children|kids|son|sons|daughter|daughters)|adult (?:children|kids|son|daughter)|my children have (?:left|moved|grown)|empty nest|grand-?(?:child|children|kids|son|daughter)|grandma|grandpa|grandmother|grandfather|(?:children|kids) (?:are )?(?:grown|married|all grown))\b/, true),
  cue([["c_none", STRONG]], /\b(?:no (?:children|kids|child)|childless|(?:don't|do not|doesn't) have (?:any )?(?:children|kids)|haven't had (?:any )?children|without children)\b/, true),
  cue([["c_some", CLEAR + 0.2], ["t_parenting", CLEAR]], /\b(?:(?:my|our) (?:children|kids|child|son|daughter|boys|girls|twins|sons|daughters)|we have (?:\w+ )?(?:children|kids)|i have (?:\w+ )?(?:children|kids)|mother of|father of|mum of|mom of|dad of)\b/, true),
  cue([["t_parenting", STRONG], ["c_some", CLEAR]], /\b(?:parent(?:ing|s)?|raising (?:my|our|the) (?:children|kids)|raise (?:my|our) (?:children|kids)|single (?:mum|mom|mother|dad|father|parent))\b/),
  cue([["t_home", CLEAR + 0.4]], /\b(?:our home|my home|family (?:devotion|altar|prayer|time|rhythm|routine|worship)|household|home (?:needs|rhythm|routine|life|atmosphere|altar)|rhythm|routine at home|faith[- ]filled home|chaos at home|busy home)\b/),

  // ---------------------------------------------------------------- what is on their mind
  cue(["t_career", FAINT + 0.2], /\b(?:career|profession(?:al)?|climb(?:ing)? the ladder|plateau|work[- ]life)\b/),
  cue([["t_switch", STRONG], ["t_career", FAINT]], /\b(?:change (?:my )?career|switch(?:ing)? (?:career|careers|industries|fields)|career (?:change|switch|pivot)|pivot(?:ing)?|transition(?:ing)? (?:into|out of)|new field|different (?:path|field|industry|direction)|reinvent|leave (?:banking|my job|corporate)|thinking of leaving)\b/),
  cue([["t_clients", CLEAR]], /\b(?:clients?|pipeline|proposals?|retainers?|prospects|referrals|invoices?|gigs?)\b/),
  cue(["t_pricing", CLEAR], /\b(?:pric(?:e|ing)|what to charge|how much to charge|packag(?:e|es|ing)|undervalu(?:e|ed)|underpaid|my rates)\b/),
  cue([["t_abroad", STRONG], ["t_move", CLEAR]], /\b(?:abroad|overseas|diaspora|japa(?:ed)?|expat|uk|united kingdom|england|london|manchester|canada|toronto|usa|america|united states|houston|atlanta|dallas|dubai|uae|germany|ireland|australia)\b/),
  cue([["t_move", STRONG], ["t_abroad", CLEAR]], /\b(?:relocat(?:e|ed|ing|ion)|moving (?:to|abroad|country)|move (?:to|abroad)|migrat(?:e|ion|ing)|visa|emigrat(?:e|ion)|immigrat(?:e|ion)|new country|cross[- ]border|resettl(?:e|ing)|just (?:arrived|moved)|study permit|work permit|green card)\b/),
  cue([["t_distance", STRONG], ["t_abroad", CLEAR]], /\b(?:miss(?:ing)? (?:home|nigeria|my family|church)|far from (?:home|family)|long[- ]distance|time ?zones?|homesick|back home)\b/),
  cue(["t_distance", FAINT], /\bmy (?:family|parents|mum|mom|dad|siblings|children|kids|wife|husband)(?: and (?:my )?\w+)? (?:are |is )?(?:back )?(?:in|back home)\b/),
  cue(["t_move", CLEAR], /\b(?:returning (?:to nigeria|home)|going back (?:home|to nigeria)|come back home)\b/),
  cue([["t_rebuild", STRONG]], /\b(?:divorc(?:e|ed|ing)|separat(?:ed|ion)|break ?up|broke up|(?:relationship|marriage|engagement) (?:has |had )?ended|ended (?:our|my|the) (?:relationship|marriage|engagement)|heartbreak|heartbroken|widow(?:ed)?|rebuild(?:ing)? after|was married|used to be married|previously married|my late (?:husband|wife)|my ex(?:-?husband|-?wife)?)\b/),
  cue([["t_fitness", STRONG], ["t_health", CLEAR]], /\b(?:fitness|gym|exercis(?:e|ing)|work ?out|jogging|weight loss|lose weight|healthy (?:eating|lifestyle|habits)|diet|marathon|football|sports?|yoga|swim(?:ming)?|cycling|nutrition|get fit|stay fit)\b/),
  cue(["t_fitness", CLEAR], /\b(?:running|walking|stamina|strength|athlet(?:e|ic|ics)|body)\b/),
  cue(["t_health", CLEAR], /\b(?:my health|healthier|better health|health goals?|wellbeing|well-being|wellness|stay healthy)\b/),
  cue(["t_habit", CLEAR], /\b(?:consistent(?:ly)?|consistency|habits?|discipline|every day|daily|regularly|stay on track|stick to)\b/),
  cue(["t_milestone", CLEAR], /\b(?:lose \d+|\d+ ?kg|5k|10k|half[- ]marathon|milestone|target weight|goal weight|race|tournament|competition)\b/),
  cue([["t_teach", CLEAR], ["f_education", CLEAR]], /\b(?:classroom|curriculum|lesson plans?|my pupils|my students|lecturing)\b/),
  cue([["t_burnout", STRONG]], /\b(?:burn(?:ed|t)?[- ]?out|exhausted|drained|overwork(?:ed)?|overwhelmed|running on empty|stretched thin)\b/),
  cue([["t_calling", CLEAR]], /\b(?:calling|vocation|called (?:to|into)|marketplace ministry|kingdom (?:impact|business)|use my (?:gifts?|talents?|skills) for god|purpose)\b/),
  cue([["t_specialise", STRONG]], /\b(?:specialis(?:e|ing|ation)|specializ(?:e|ing|ation)|residency|fellowship exams?|mdcn|part (?:i|ii|1|2) exams?|sub-?specialt(?:y|ies)|consultant (?:doctor|physician|surgeon))\b/),
  cue([["t_skills", CLEAR + 0.2]], /\b(?:new skills?|upskill(?:ing)?|reskill(?:ing)?|retool(?:ing)?|bootcamp|short course|certification|get certified|learn(?:ing)? (?:a |to )?(?:code|coding|data|excel|python|design|digital marketing|tech)|improve my skills)\b/),
  cue([["t_release", CLEAR + 0.2], ["t_creative", CLEAR]], /\b(?:my (?:music|album|book|manuscript|film|songs?|collection|designs|portfolio|craft|art|ep)|finish(?:ing)? (?:my|the) (?:album|book|film|manuscript|ep|project|collection)|release (?:my|the|date)|exhibition|mixtape)\b/),
  cue(["t_income", CLEAR], /\b(?:income|monetis(?:e|ing)|monetiz(?:e|ing)|make money|earn(?:ing)? (?:from|a living|more)|paid for my|side income|extra income|financially independent)\b/),

  // ---------------------------------------------------------------- walk with God, only if they say so
  cue(["faith_new", STRONG], /\b(?:new (?:believer|christian|convert)|just (?:gave|surrendered|accepted|committed) (?:my life|myself)|recently (?:gave|surrendered|accepted|committed|born again)|gave my life to (?:christ|jesus) (?:recently|last|this|a few)|new to (?:church|faith|following jesus|christianity)|just started (?:going to church|following jesus))\b/, true),
  cue(["faith_exploring", STRONG], /\b(?:exploring (?:faith|christianity|church)|not sure what i believe|searching for god|curious about (?:god|faith|church|jesus)|visiting church|looking into (?:faith|church)|seeker)\b/, true),
  cue(["faith_growing", CLEAR], /\b(?:growing in (?:my )?(?:faith|walk)|learning to (?:pray|trust god|read my bible)|deepen(?:ing)? my (?:faith|walk|prayer life))\b/),
  cue(["faith_established", STRONG], /\b(?:(?:walked|walking|followed|following|served|serving) (?:with )?(?:god|jesus|christ|the lord) for (?:over |more than |about |almost )?(?:\d+|many|several|ten|twenty|thirty|forty) years|(?:born|raised) in the church|christian for (?:\d+|many|several|years)|been a christian (?:for|since)|grew up in (?:the )?church|pastor'?s kid)\b/, true),
  cue([["faith_leading", STRONG], ["f_ministry_ngo", FAINT]], /\b(?:pastor|reverend|youth (?:pastor|leader)|church (?:worker|leader|elder)|deacon(?:ess)?|(?:i )?(?:lead|leading|teach|teaching|mentor|mentoring|disciple|discipling) (?:a |the |our |my |in )?(?:cell|fellowship|bible study|youth|sunday school|small group|department|ministry|choir|home cell|house fellowship|children'?s church|teens church)|(?:i )?serve (?:as|in) (?:the )?(?:church|choir|ushering|media|protocol|worship team|children'?s church|department)|mentor(?:ing)? (?:younger|others|people|youths?)|disciple(?:ing)? others)\b/, true),
  cue(["serve_yes", CLEAR], /\b(?:(?:i )?(?:love|want|would like|desire) (?:to )?(?:serve|lead|mentor|help others|disciple|facilitate|lead an? (?:tribe|circle))|ready to (?:lead|serve)|(?:open|willing) to (?:serve|lead)|passion for (?:mentoring|discipleship))\b/),
  cue(["serve_not_now", CLEAR], /\b(?:don't have (?:the )?(?:time|capacity)|too busy|no capacity|not now|overloaded|can't take (?:on )?more)\b/),

  // ---------------------------------------------------------------- the part they play in a group
  cue(["role_encourager", CLEAR], /\b(?:encourag(?:e|er|ing|ement)|motivat(?:e|or|ing)|cheer(?:ing)? (?:people|others|them) on|uplift(?:ing)?|lift(?:ing)? (?:people|others) up|supportive|cheerleader)\b/),
  cue(["role_organiser", CLEAR], /\b(?:i(?:'m| am) (?:an? |the )?(?:organi[sz]er|planner)|(?:love|like) (?:to )?(?:plan|organi[sz]e)|i (?:plan|organi[sz]e) (?:everything|events|things|trips)|keep (?:us|everyone|things) (?:on track|organi[sz]ed)|spreadsheets?|project manage(?:r|ment)?|coordinat(?:e|or|ing)|logistics|timekeeper)\b/),
  cue(["role_host", CLEAR + 0.2], /\b(?:hospitality|(?:love|like|enjoy) (?:to )?(?:cook|host|entertain|feed)|open (?:my|our) (?:house|home|doors)|welcome (?:people|guests|visitors)|hosting|my house is always)\b/),
  cue(["role_thinker", CLEAR], /\b(?:thinker|reflective|analy[sz]e|analytical|(?:love|like|enjoy) (?:to )?(?:read|research|question)|bookworm|deep questions|deeper questions|researcher|study(?:ing)? the (?:word|bible|scriptures))\b/),
  cue(["role_peacemaker", CLEAR + 0.2], /\b(?:peacemaker|keep(?:s|ing)? the peace|mediat(?:e|or|ing)|reconcil(?:e|iation|er)|calm(?:ing)? (?:things|people|tensions|situations) down|diffus(?:e|ing) (?:tension|conflict)|(?:hate|avoid|dislike) (?:conflict|fighting|quarrels?|arguments?)|bring(?:ing)? peace)\b/),
  cue(["role_prayer_warrior", CLEAR + 0.2], /\b(?:prayer warrior|intercess(?:or|ion|ory)|pray(?:ing)? for (?:people|others|everyone|my friends)|prayer (?:group|meeting|team|line|chain)|(?:love|enjoy) (?:to )?pray|midnight prayers?|prayer life)\b/),
  cue(["role_truth_teller", CLEAR], /\b(?:(?:say|speak|tell) (?:it|things|the truth) (?:as it is|straight|plainly|honestly)|straightforward|blunt|call (?:it|things) as (?:i|they) see|hold(?:ing)? (?:people )?accountab|accountability partner|speak(?:ing)? the truth|truth-?teller|don't sugar ?coat|no nonsense)\b/),
  cue(["role_connector", CLEAR], /\b(?:connector|network(?:er|ing)|bring(?:ing)? people together|introduc(?:e|ing) people|mobili[sz](?:e|er|ing)|people person|know everyone|organi[sz]e (?:gatherings|events|meetups|get-togethers))\b/),

  // ---------------------------------------------------------------- how they like to work with people
  cue(["st_quiet", STRONG], /\b(?:(?:i(?:'m| am)|am) (?:an? )?(?:introvert|shy|quiet|reserved|private)|prefer (?:one[- ]on[- ]one|small groups?|quiet)|keep to myself)\b/, true),
  cue(["st_social", STRONG], /\b(?:(?:i(?:'m| am)|am) (?:an? )?(?:extrovert|outgoing|talkative|chatty|people person)|love (?:a )?(?:crowd|groups|parties|gatherings)|life of the party)\b/, true),
  cue(["st_plan", CLEAR + 0.4], /\b(?:(?:like|love|prefer|need) (?:a |to have a )?(?:clear )?(?:plan|schedule|structure|routine|agenda|timetable)|i plan (?:everything|ahead)|like to know (?:what|where))\b/, true),
  cue(["st_flow", STRONG], /\b(?:go(?:ing)? with the flow|spontaneous|play it by ear|see where (?:it|things) go|not (?:a )?planner|improvis(?:e|ing))\b/, true),
  cue(["st_new", STRONG], /\b(?:(?:love|like|enjoy) (?:trying|to try) (?:new )?(?:things)?|try something new|adventurous|innovative)\b/, true),
  cue(["st_steady", STRONG], /\b(?:(?:like|prefer|love) (?:to )?(?:stick|keep) (?:with|to) what (?:works|i know)|creature of habit|tried and tested|(?:don't|do not) like (?:change|surprises))\b/, true),
  cue(["st_direct", STRONG], /\b(?:(?:i )?(?:say|speak) (?:what i think|my mind)|(?:i(?:'m| am) )?(?:direct|blunt|frank))\b/, true),
  cue(["st_peace", STRONG], /\b(?:(?:avoid|hate|dislike) (?:conflict|confrontation|arguments?)|(?:i(?:'m| am) )?(?:diplomatic|gentle|soft[- ]spoken)|people[- ]pleaser|don't like to offend)\b/, true),
  cue(["st_open_fast", STRONG], /\b(?:open up (?:quickly|fast|easily)|wear my heart on my sleeve|open book|overshare)\b/, true),
  cue(["st_open_slow", STRONG], /\b(?:(?:slow|hard|takes? (?:me )?time) to (?:open up|trust)|(?:need|take) time to (?:trust|open up)|guarded|private person)\b/, true),
  cue(["st_doing", STRONG], /\b(?:learn(?:s)? (?:best )?by doing|hands[- ]on|trial and error|roll up (?:my )?sleeves)\b/, true),
  cue(["st_talking", STRONG], /\b(?:(?:learn|think) (?:best )?(?:by|through) (?:talking|discussion|discussing|conversation)|talk (?:it|things) through|think out loud|(?:love|like) (?:to )?(?:discuss|debate))\b/, true),

  // ---------------------------------------------------------------- where they are on the goal
  cue(["p_1", CLEAR], /\b(?:haven't started|have not started|not started|never (?:done|tried)|zero progress|from scratch|starting from nothing|square one|just an idea|only an idea|nothing yet)\b/),
  cue(["p_2", CLEAR], /\b(?:thinking (?:about|of)|considering|wondering (?:if|how|whether)|(?:hoping|want(?:ing)?|would like) to start|plan(?:ning)? to|dreaming|not sure where to begin)\b/),
  cue(["p_3", CLEAR], /\b(?:just started|recently started|taking (?:my )?first steps|early days|first steps|getting going|trying to build)\b/),
  cue(["p_4", CLEAR], /\b(?:making progress|half[- ]?way|going well|some traction|already (?:have|got|started|registered|launched)|steady progress|progress so far)\b/),
  cue(["p_5", CLEAR], /\b(?:almost there|nearly there|close to (?:finishing|done)|final stretch|about to (?:finish|complete|launch|release)|nearly done|almost done|ready to launch)\b/),
];

/** Said before a status, these mean it is not (yet) true: "not married", "want to start a business", "hope to". */
const NOT_TRUE_NOW = /\b(?:not|never|no longer|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|dont|hope to|hoping to|wish|wishing|want to|wanna|planning to|plan to|used to|if i|when i|someday|one day)(?:\s+[a-z']+){0,2}\s*$/;

export type Hit = { trait: Trait; weight: number; quote: string };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** The words that caused a pick, short enough to say back: “lost my job”. */
function shorten(quote: string, max = 38): string {
  const q = clean(quote);
  if (q.length <= max) return q;
  const cut = q.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 12))}…`;
}

/** The strongest sighting of each trait in a piece of writing, with the words that showed it. */
export function readText(text: string, max = 1500): Hit[] {
  const original = text.slice(0, max);
  if (original.trim().length < 3) return [];
  const lower = original.replace(/[‘’`´]/g, "'").toLowerCase();
  const out = new Map<Trait, Hit>();
  for (const c of CUES) {
    const found = c.re.exec(lower);
    if (!found || found[0].trim().length < 2) continue;
    if (c.fact) {
      const sentenceStart = Math.max(lower.lastIndexOf(".", found.index), lower.lastIndexOf("!", found.index), lower.lastIndexOf("?", found.index), found.index - 30);
      if (NOT_TRUE_NOW.test(lower.slice(Math.max(0, sentenceStart), found.index))) continue;
    }
    const quote = shorten(original.length === lower.length ? original.slice(found.index, found.index + found[0].length) : found[0]);
    for (const [trait, weight] of c.traits) {
      if (weight <= 0) continue;
      const have = out.get(trait);
      if (!have || weight > have.weight) out.set(trait, { trait, weight, quote });
    }
  }
  return [...out.values()];
}
