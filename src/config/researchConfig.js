export const SCHEMA_VERSION = 20;
export const PROMPT_VERSION_FREE = 'free-ai-v8-student-supplied-context';
export const PROMPT_VERSION_SUPPORTED = 'help-seeking-support-v12-student-supplied-context';
export const QUESTIONNAIRE_VERSION = 'li-help-seeking-intention-genai-v2-minimal-adaptation';

export const CONDITIONS = ['unassigned', 'A', 'B'];

export const COMMON_AI_RESPONSE_RULES = [
  '面向初中生回答，语言清楚、自然、准确，避免无关的长篇铺陈和重复任务说明。',
  '回答长度由学生当前问题决定：简单问题可以很短，复杂问题可以适当展开；不强制80—160字、不固定3点、不为了格式而拆分。',
  '实验组与对照组共享同一任务资料、事实边界、图片能力和基础语气；共同规则不教授任何学业求助策略。',
  '前期学生访谈/试用反馈仅用于改进可读性与平台体验，不把“固定短回复”作为实验处理。',
];


export const DEFAULT_SETTINGS = {
  active_session_id: 'W2',
  session_open: true,
  questionnaire_enabled: true,
  cohort_revision: 'cohort-initial',
  locked_session_ids: [],
};


export const PROTECTED_SESSION_IDS = ['W1', 'W2'];

export const INTERVENTION_ORIENTATION = {
  supported: {
    key: 'adaptive-help-seeking-learning-v1',
    title: 'AI求助小练习',
    intro: '先用几分钟认识一种更有利于自己继续思考的AI求助方式。这里不是教固定句式，也不会影响你的设计答案。',
    cards: [
      {
        title: '1｜先弄清楚：我现在需要什么帮助？',
        body: [
          '问AI前，先确认自己已经做到哪一步、具体卡在哪里，以及希望AI帮哪一部分。',
          '不需要每次写很长，但尽量让AI知道你的真实困难，而不是只丢下一句“帮我做完”。',
        ],
        example_bad: '例：帮我把这个辅助绘画装置完整设计好。',
        example_good: '例：我已经想到用腕带固定画笔，但不知道怎样让画笔更稳定。你能帮我比较两种固定方式吗？',
      },
      {
        title: '2｜求助中：让AI帮助你继续做',
        body: [
          '你可以请AI解释、提示、比较、澄清、检查已有想法，或分析测试现象。',
          '如果第一次回答没解决问题，可以继续追问、补充条件或让AI换一种方式解释。',
        ],
      },
      {
        title: '3｜得到帮助后：自己判断怎么用',
        body: [
          '看看AI的帮助是否和你的问题相关、你是否真的理解、哪些部分适合你的方案。',
          '最终选择、取舍和修改理由仍由你自己决定；AI的建议可以采用、修改，也可以不用。',
        ],
      },
    ],
    checks: [
      {
        id: 'q1',
        question: '准备向AI求助时，下面哪种做法更合适？',
        options: [
          '先让AI给出完整方案，再从中挑选一个',
          '先说明当前进展和困难，再请AI帮助这一部分',
          '先把全部任务要求发给AI，让它决定从哪里开始',
        ],
        correct: 1,
      },
      {
        id: 'q2',
        question: '拿到AI的建议后，下面哪种处理更合适？',
        options: [
          '先看是否符合自己的问题，再决定采用还是调整',
          '先照着建议完成作品，再看最后效果是否满意',
          '先继续让AI多给几个方案，再选内容最多的一个',
        ],
        correct: 0,
      },
      {
        id: 'q3',
        question: 'AI第一次解释没有解决你的问题时，下一步更合适的是：',
        options: [
          '换一个全新的问题重新问，不再处理原来的困惑',
          '让AI直接给出最后答案，减少继续沟通的时间',
          '补充缺少的信息或指出哪里没懂，再继续追问',
        ],
        correct: 2,
      },
    ],
    button: '完成小练习，进入设计任务',
  },
  control: {
    key: 'neutral-platform-orientation-v1',
    title: '平台操作小练习',
    intro: '先用几分钟熟悉平台的记录方式和基本操作。',
    cards: [
      {
        title: '1｜任务记录会自动保存',
        body: [
          '你在任务文本框中的内容会自动保存，也可以在下课时点击“保存进度并退出”。',
          '“完成本阶段”只是完成标记；在老师统一结束并锁定前，如果误点或还想修改，可以重新进入继续修改。',
        ],
      },
      {
        title: '2｜草图和原型照片要拍清楚',
        body: [
          '需要上传图片的课次，请让主要结构清楚可见；画功和照片美化都不是本研究重点。',
          '草图和简单模型重点是表达想法、测试关键功能，不要求做成精致成品。',
        ],
      },
      {
        title: '3｜AI回复时请等待',
        body: [
          'AI正在处理时，页面会显示明显提示；回复完成后才能继续发送。',
          '平台会保存已发送的聊天记录，方便你之后回看。',
        ],
      },
    ],
    acknowledgements: [
      '我知道任务文字会自动保存，没做完可以保存进度，下次继续。',
      '我知道AI正在处理时需要等待回复完成。',
      '我知道草图和简单模型主要用于表达和测试，不按画功或外观精致程度打分。',
    ],
    button: '我已了解，进入设计任务',
  },
};

export const INTERVENTION_SUPPORT_CARDS = {
  W3: {
    title: 'AI求助提醒',
    lines: ['先想清：我已经做到哪？具体卡在哪里？', '说清楚：我希望AI具体帮哪一部分？', '拿到帮助后：判断是否适合，再决定怎么改。'],
  },
  W4: {
    title: 'AI求助提醒',
    lines: ['带着自己的方案或具体困难去问，会更容易得到针对性帮助。', '可以请AI解释、比较、检查、澄清；最终方案由你自己判断。'],
  },
  W5: {
    title: '测试后的AI求助提醒',
    lines: ['先说清真实测试现象，再请AI帮你分析可能原因或比较修改方向。', 'AI给的是建议，不是已经发生的测试证据。'],
  },
  W6: {
    title: '修改阶段提醒',
    lines: ['把测试证据、已有判断和你最需要解决的问题说清楚。', '收到建议后，决定采用、修改还是不用，并说明自己的依据。'],
  },
  W7: {
    title: '轻提示',
    lines: ['需要AI时，尽量围绕当前具体问题求助；核心选择留给自己。'],
  },
  W8: {
    title: '轻提示',
    lines: ['需要AI时，围绕具体问题求助；最后自己判断AI帮助怎样进入最终修改。'],
  },
};


// 李晓东《中小学生学业求助问卷》“学业求助意图”部分（原题17–30）
// 本研究仅做情境适配：数学/老师同学 -> 设计任务/生成式AI；维度、题数、5点评分保持不变。
export const QUESTIONNAIRE_ITEMS = [
  { id:'IHS1', source_no:17, dimension:'instrumental', text:'如果我做不出设计任务中的某个问题，我会请生成式AI给我一些提示。' },
  { id:'IHS2', source_no:18, dimension:'instrumental', text:'在完成设计任务时，如果我不明白任务要求，我会向生成式AI请教。' },
  { id:'IHS3', source_no:19, dimension:'instrumental', text:'当我面对一个设计问题而不知道如何入手时，我会请生成式AI给我讲解解决问题的思路。' },
  { id:'IHS4', source_no:20, dimension:'instrumental', text:'当我怎么也解决不了设计任务中的问题时，我会请生成式AI讲解解决问题的方法。' },
  { id:'IHS5', source_no:21, dimension:'instrumental', text:'当我的设计出现问题，却又不知道问题在哪里时，我会请生成式AI帮助我分析问题。' },
  { id:'EHS1', source_no:22, dimension:'executive', text:'虽然我自己动脑筋也能完成设计任务中的一些内容，但这样做很麻烦，所以我常常请生成式AI直接告诉我怎么做。' },
  { id:'EHS2', source_no:23, dimension:'executive', text:'对于设计任务，我会不做任何尝试就直接向生成式AI要答案或完整方案。' },
  { id:'EHS3', source_no:24, dimension:'executive', text:'我常常请生成式AI替我完成设计任务中本来应该由我完成的主要内容。' },
  { id:'EHS4', source_no:25, dimension:'executive', text:'不会完成设计任务时，我会直接照搬生成式AI给出的内容或方案。' },
  { id:'EHS5', source_no:26, dimension:'executive', text:'遇到不会解决的设计问题时，我会照搬生成式AI给出的答案或方案。' },
  { id:'AHS1', source_no:27, dimension:'avoidance', text:'遇到不会解决的设计问题时，我宁愿随便写一个答案或方案，也不会向生成式AI求助。' },
  { id:'AHS2', source_no:28, dimension:'avoidance', text:'即使我没有理解设计任务中的要求或相关知识，我也不会向生成式AI发问。' },
  { id:'AHS3', source_no:29, dimension:'avoidance', text:'虽然我已经尝试了很长时间仍没有解决设计问题，我也不会向生成式AI求助。' },
  { id:'AHS4', source_no:30, dimension:'avoidance', text:'即使我在理解设计任务相关知识时遇到困难，我也不会向生成式AI求助。' },
];

export const QUESTIONNAIRE_META = {
  version: QUESTIONNAIRE_VERSION,
  title: '设计任务中的生成式AI学业求助意图问卷',
  instruction: '在完成设计任务的过程中，你可能会遇到各种困难，也可能会使用生成式AI寻求帮助。请判断在出现下列情况时，你采取相应做法的可能性。没有正确或错误答案，请按真实情况选择。',
  scale: [
    { value:1, label:'极不可能' },
    { value:2, label:'不可能' },
    { value:3, label:'有些可能' },
    { value:4, label:'可能' },
    { value:5, label:'极可能' },
  ],
  source_note: '基于李晓东《中小学生学业求助问卷》学业求助意图分问卷（原17–30题）进行最小情境适配：数学/老师同学情境改为设计任务/生成式AI；保持工具性5题、执行性5题、回避4题及5点评分结构不变。该版本是本研究的情境适配稿，不宣称已经在生成式AI情境中完成独立效度验证。',
};

const field = (key, label, options = {}) => ({
  key,
  label,
  type: options.type || 'textarea',
  required: options.required !== false,
  placeholder: options.placeholder || '',
  helper: options.helper || '',
  stage: options.stage || 'before_update',
});
const artifact = (key, label, options = {}) => ({
  key,
  label,
  required: options.required !== false,
  helper: options.helper || '请拍清楚后上传 JPG、PNG 或 WEBP 图片。',
});

export const SESSIONS = [
  {
    id:'W1', order:1, date:'9/14',
    title:'椅子快速设计挑战', subtitle:'Pilot｜测试平台、AI使用与数据记录',
    student_label:'第1课 · 设计热身', research_role:'pilot', phase:'pilot', ai_mode:'free', candidate:false,
    brief:[
      '小林喜欢坐着画画。画画时，他经常同时使用画本、画笔和水杯。',
      '普通椅子只能坐，很多东西没地方放，坐久了也不舒服。',
      '请为小林重新设计一把更适合画画的椅子。',
    ],
    requirements:['至少解决一个真实问题。','功能要能说明大概如何实现。','草图不比画功，只要别人能看懂想法。'],
    fields:[field('need_statement','你认为小林最需要解决的问题是什么？'),field('design_note','用一句话说明你的设计思路')],
    artifacts:[artifact('design_sketch','上传你的设计草图')],
    prompt_context:'这是Pilot，不进入正式干预效果分析。学生可自由使用普通AI。',
  },
  {
    id:'W2', order:2, date:'9/21',
    title:'重新设计学校午餐体验', subtitle:'共同AI试用任务｜需求判断、方案权衡与反馈后修订',
    student_label:'第2课 · 共同试用', research_role:'pilot_trial', phase:'pilot', ai_mode:'free', candidate:false, chat_image_enabled:false,
    source_course:'Stanford d.school: Redesign the School Lunch Experience',
    brief:[
      '今天你要重新设计的不是某一道菜，而是“学校午餐体验”：从下课、了解当天选择、排队取餐、找座位、用餐，到最后离开。',
      '所有同学看到相同的课堂模拟资料。任务没有唯一标准答案，重点是根据证据判断问题、比较方案，并在新反馈出现后重新检查自己的选择。',
      '本任务改编自 Stanford d.school 的 Redesign the School Lunch Experience，保留“理解体验—定义问题—构思—获得反馈—修改”的核心过程。',
    ],
    resources:[
      {
        title:'资料A｜任务学校的基本情况',
        items:[
          '午餐时段固定为30分钟，学生需要在这段时间内完成取餐、用餐和离开。',
          '食堂场地大小本学期不能扩大，但现有空间的使用方式可以调整。',
          '学生可以在多个窗口之间选择，但不同窗口的队伍长度和出餐速度并不完全相同。',
          '本节重点是改善“整个午餐体验”，不是评价某一道菜好不好吃。',
        ],
      },
      {
        title:'资料B｜午餐体验记录',
        items:[
          '学生A：“有时候我一进食堂就不知道哪边更快，排了一会儿才发现另一队已经走了很多人。”',
          '学生B：“我常常到窗口前才看清今天有哪些选择，前面的人一犹豫，后面的队伍就越来越长。”',
          '学生C：“我带饭，但朋友要排队买饭。等大家终于坐到一起，午餐时间已经过去一大半了。”',
          '学生D：“我当然希望快一点，但我也不想为了快就完全没有选择；我还希望吃完能有几分钟放松。”',
          '学生E：“有时空位其实不少，但书包和外套占了座位，找位置还是会花时间。”',
          '工作人员：“最忙的时候，我们既要快速出餐，又要回答学生临时问的选择问题，窗口前容易堵起来。”',
        ],
      },
      {
        title:'资料C｜可以改变什么',
        items:[
          '可以重新设计信息呈现方式、排队与取餐流程、座位和动线的使用方式，或加入简单可行的工具。',
          '方案不必解决资料里的所有问题，但要说清楚你优先解决谁的什么问题。',
          '方案需要兼顾学生体验和工作人员实际执行，不能只追求“看起来很酷”。',
          '重要的是说明判断依据和取舍，而不是猜一个所谓标准答案。',
        ],
      },
    ],
    requirements:[
      '请先完整阅读共同资料，再按顺序完成任务记录。',
      '至少提出3个在解决方式上明显不同的方向，不能只是换名字、颜色或很小的细节。',
      '先作出一次初步选择，再点击“查看新反馈”；看到新信息后可以修改，也可以保留，但必须说明依据。',
      '本节会使用右侧AI助手。请在本节任务中至少实际使用1次；什么时候使用、问什么、之后是否继续使用，由你自己决定。',
      '老师只处理登录、页面操作和任务规则问题，不替你判断哪一个设计答案最好。',
    ],
    fields:[
      field('evidence_needs','1. 从资料中找出3个你认为最值得关注的午餐体验问题或需要，并分别写出证据',{placeholder:'写清：你看到了什么现象？它说明谁遇到了什么问题？'}),
      field('core_problem','2. 如果这次只能优先解决一个问题，你会选哪一个？为什么？',{placeholder:'说明这个问题影响了谁、造成了什么体验，以及你为什么暂时把它放在前面。'}),
      field('problem_definition_v1','3. 写出你的第一版问题定义',{placeholder:'用自己的话写清楚：谁需要什么样的改善，以及你依据了哪些现象或证据。'}),
      field('solution_directions','4. 提出3个明显不同的解决方向，并说明每个方向主要解决什么',{placeholder:'三个方向应在“怎么解决”上有明显差别。'}),
      field('initial_choice','5. 先选出你目前最倾向的方向：它的主要优点、可能的新问题和选择依据分别是什么？',{placeholder:'先做一次真实判断，不需要追求标准答案。'}),
      field('revision_decision','6. 【查看新反馈后填写】新反馈会不会改变你刚才的判断？哪些地方保留，哪些地方需要修改？为什么？',{stage:'after_update',placeholder:'把新信息和原方案联系起来说明。'}),
      field('final_solution','7. 写出你的最终方案：它怎样改善午餐体验，又怎样处理效率、选择感和现实执行之间的取舍？',{stage:'after_update',placeholder:'写清核心做法、服务对象和最重要的取舍。'}),
      field('locker_problem_v1','加练A. Marisol 的储物柜真正需要解决的核心问题是什么？',{required:false,stage:'bonus_before',placeholder:'不要只写“太乱”。说明这种情况为什么会影响她的学校生活。'}),
      field('locker_plan_v1','加练B. 在还没有看到新增条件前，你会先考虑什么解决方向？为什么？',{required:false,stage:'bonus_before',placeholder:'先写你的第一判断。'}),
      field('locker_revision','加练C. 看完新增条件后，你会怎样修改前面的判断或方案？请说明哪些条件改变了你的想法。',{required:false,stage:'bonus_after',placeholder:'可以保留原方向，也可以修改；关键是说明依据。'}),
    ],
    mid_task_update:{
      title:'第二轮｜收到新的学校反馈',
      intro:'先完成前5题并作出初步选择，再查看下面的新反馈。真实设计通常会在新条件出现后重新检查原来的判断。',
      button:'我已经完成初步选择，查看新反馈',
      after_fields:['evidence_needs','core_problem','problem_definition_v1','solution_directions','initial_choice'],
      items:[
        '学校确认：午餐时段不能延长，本学期也不能增加服务窗口或额外增加工作人员。',
        '学生在校期间不能依赖个人手机完成点餐、预约或取餐操作。',
        '新的学生反馈显示：大家希望提高效率，但不接受“为了更快而只剩一种固定选择”的做法。',
        '因此，新方案需要在“效率、选择感和现实可执行性”之间重新权衡。',
      ],
    },
    bonus_task:{
      id:'locker',
      title:'有时间再做｜Marisol 的储物柜问题',
      subtitle:'成熟案例加练：先做第一判断，再根据新增约束修订',
      source_course:'TeachEngineering: Solving Everyday Problems Using the Engineering Design Cycle',
      unlock_after:['final_solution'],
      button:'午餐任务完成了，我还有时间做加练',
      brief:[
        'Marisol 在两节课之间只有大约5分钟。她的储物柜越来越乱，经常要花很久找课本、作业和小物品，有时因此迟到。',
        '先根据这段基本情境判断问题和方向；完成前两题后，再查看工程案例里的新增条件。',
      ],
      update:{
        title:'新增条件｜现在再检查你的第一判断',
        button:'我已经写好第一判断，查看新增条件',
        after_fields:['locker_problem_v1','locker_plan_v1'],
        items:[
          '现成的储物柜整理器大约需要30美元，但 Marisol 能用于解决这个问题的预算不到3美元。',
          '储物柜大约高32英寸、宽12英寸、深9.5英寸，空间不能扩大。',
          '她需要放置的7本教材合计约28磅，另外还有约5磅的小物品，因此不能只考虑“看起来整齐”。',
          '现在请重新判断：原来认为的核心问题和解决方向是否需要改变？',
        ],
      },
    },
    artifacts:[],
    ai_use_required_once:true,
    ai_instruction:'本节会使用AI设计助手。请至少实际使用1次；具体什么时候使用、向AI询问什么、是否继续追问，都由你自己决定。',
    prompt_context:'当前是正式分组前的共同AI试用任务。主任务改编自 Stanford d.school 的 Redesign the School Lunch Experience；有时间时可进入 TeachEngineering 的 Marisol 储物柜案例加练。所有学生本节都使用同一个普通AI，不提供实验性学业求助支持。平台已经给出完成任务所需的共同资料，不要求外部检索。AI根据学生实际问题正常帮助，可以解释、比较、给设计想法或反馈；不要主动套用工具性/执行性分类，不要透露研究设计。',
  },
  {
    id:'W3', order:3, date:'9/28',
    title:'辅助绘画装置：了解需要，想出两个不同方案', subtitle:'正式项目｜设计标准和限制条件｜至少两个不同方案',
    student_label:'第3课 · 正式主项目', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false,
    source_course:'TeachEngineering: An Assistive Artistic Device（Grades 7–8）',
    brief:[
      '从这节课开始，你们要正式进入这个设计任务：为一位手部动作控制有困难、但希望自己参与绘画的使用者设计辅助绘画装置。',
      '今天主要完成四件事：了解使用者需要，分清已经知道什么和还需要了解什么，写出设计标准和限制条件，想出至少两个不同方案。',
      '后面你们还会把想法做成一个可以拿来试一试的小样或简单模型，重点是先验证关键功能，再根据测试结果修改，不需要一开始就做得很精致。',
      '开始构思前，先看看可以使用的材料。你的方案要尽量在这些材料范围内完成。',
    ],
    materials:[
      { group:'主体材料', items:[
        { icon:'📦', label:'瓦楞纸板' },
        { icon:'📄', label:'卡纸' },
        { icon:'🧽', label:'泡棉片' },
        { icon:'🧽', label:'海绵' },
        { icon:'🧵', label:'布' },
        { icon:'🪡', label:'毛毡' },
      ]},
      { group:'连接和固定材料', items:[
        { icon:'🪵', label:'木棒' },
        { icon:'🥤', label:'纸吸管' },
        { icon:'⭕', label:'橡皮筋' },
        { icon:'🎗️', label:'宽松紧带' },
        { icon:'🧷', label:'魔术贴' },
        { icon:'🪢', label:'绳子' },
        { icon:'🩹', label:'胶带 / 双面胶' },
        { icon:'📎', label:'小夹子' },
      ]},
      { group:'测试工具', items:[
        { icon:'✏️', label:'铅笔' },
        { icon:'🖍️', label:'蜡笔' },
        { icon:'🖊️', label:'马克笔' },
        { icon:'✏️', label:'彩色铅笔' },
        { icon:'🖌️', label:'小画笔' },
      ]},
    ],
    requirements:[
      '明确基本要求：装置要安全，能用提供的材料制作和测试，并能帮助使用者使用一种绘画工具。',
      '每位同学独立完成自己的文字思考、草图、AI对话和小样或简单模型；材料可以共用，但研究记录和作品以个人为单位。',
      '写出2—4条设计标准，以及必须遵守的限制条件。设计标准就是这个装置希望做到什么；限制条件就是制作时必须遵守什么。',
      '至少想出两个不同方案。这两个方案要在结构或工作方式上明显不同，不能只是颜色或外形稍微不同。',
      '根据设计标准比较两个方案，并说明你目前更倾向哪一个以及理由。草图主要用来表达结构和做法，不用担心画得像不像。',
    ],
    fields:[
      field('evidence','关于这位使用者，你已经知道什么？还想进一步了解什么？'),
      field('criteria_constraints','你认为这个装置应该做到什么？制作时又要遵守哪些要求？'),
      field('idea_1','方案1：你的核心想法是什么？它怎样帮助使用者？'),
      field('idea_2','方案2：它和方案1有什么明显不同？'),
      field('comparison','比较两个方案：各自的优点、可能问题和依据是什么？'),
      field('materials_plan','如果先做一个可以测试的小样，你准备选哪些材料？这些材料分别做什么？',{required:false}),
      field('selected_idea','目前你更倾向哪个方案？为什么？',{required:false}),
    ],
    artifacts:[artifact('idea_sketch','上传至少包含两个方案的草图 / 结构示意')],
    ai_instruction:'AI设计助手在本节全程可用。请按课堂要求使用；什么时候问、问什么、是否继续追问，不使用固定提问模板。',
    prompt_context:'正式主项目W3：使用者理解、问题定义、criteria/constraints、多方案构思与比较。项目来源为TeachEngineering的An Assistive Artistic Device，并做了普通课堂材料与低保真原型适配。本节从新项目开始，不承接W2午餐任务。共同材料银行：瓦楞纸板/卡纸、EVA或海绵、布或毛毡、木棒、纸吸管、橡皮筋、宽松紧带、魔术贴、绳、胶带/双面胶、小夹子；测试工具为铅笔、蜡笔、马克笔或小画笔。AI提出制作建议时优先限制在这些材料内，不默认学生拥有3D打印、热熔胶、电动工具或其他特殊材料。',
  },
  {
    id:'W4', order:4, date:'10/12',
    title:'辅助绘画装置：做出第一版可测试作品', subtitle:'先把关键功能做出来｜不追求精致外观',
    student_label:'第4课 · 正式主项目', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false, carry_from:'W3',
    brief:[
      '把选定方案转成第一版可测试原型（V1）。',
      '这第一版只需要让最关键的结构或功能能够被试一试。原则上继续使用W3已经公布的共同材料，不临时加入只有个别学生才有的特殊材料。',
      '制作本身不是重点；更重要的是把想法做成一个可以拿来测试、能产生证据的作品。',
    ],
    requirements:[
      '优先完成一个最关键、真正能测试的功能，不要求外观完整。',
      '遇到制作问题时记录“具体卡在哪里”，不要只写“做不出来”。',
      '保存V1照片；制作过程中不需要为了和AI聊天而中断实际操作。',
    ],
    fields:[
      field('build_target','这版V1最想先验证哪个关键功能？'),
      field('build_challenge','制作过程中最难解决的具体问题是什么？'),
      field('v1_function','V1目前已经能实现什么？还有什么暂时做不到？'),
    ],
    artifacts:[artifact('v1_photo','上传第一版作品照片')],
    ai_instruction:'AI设计助手可用于解释材料/结构、分析具体制作困难或比较可行做法；制作时无需为了聊天停下手中的操作。',
    prompt_context:'正式主项目W4：低保真V1制作。原型只需能测试关键功能，不要求精致成品。共同材料银行与W3一致：瓦楞纸板/卡纸、EVA或海绵、布或毛毡、木棒、纸吸管、橡皮筋、宽松紧带、魔术贴、绳、胶带/双面胶、小夹子；测试工具为铅笔、蜡笔、马克笔或小画笔。任务事实与学生实际制作情况优先；不得虚构学生没有报告的材料、结构或测试结果。',
  },
  {
    id:'W5', order:5, date:'10/19',
    title:'辅助绘画装置：测试第一版并解释证据', subtitle:'测试不是打分｜先记录发生了什么，再判断为什么',
    student_label:'第5课 · 正式主项目', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false, carry_from:'W4',
    brief:[
      '用同一套功能测试逻辑检查V1：装置能否稳定固定绘画工具、安装/取下是否方便、使用时是否出现明显滑动/松脱，以及是否存在安全或结构问题。不要用捆手、限制手指等方式“模拟残障”。',
      '先记录真实现象，再根据原有criteria/constraints判断哪个问题最值得修改。',
      '测试产生的新证据，是后续继续向AI提问和修改方案的依据。',
    ],
    requirements:[
      '写清测试目标、操作方式和实际结果。',
      '至少记录1—2个可观察的关键问题，区分“看到的现象”和“你的解释”。',
      '保存测试证据；AI可以帮助分析证据，但不能替你编造没有发生的结果。',
    ],
    fields:[
      field('test_goal','这次测试主要想检查什么？'),
      field('test_result','测试中实际发生了什么？请先写可观察事实。'),
      field('test_interpretation','你认为这些现象说明了什么？哪些解释还不能确定？'),
      field('key_problems','下一步最需要解决的1—2个问题是什么？为什么？'),
    ],
    artifacts:[artifact('test_evidence','上传V1测试记录 / 关键现象照片')],
    ai_instruction:'AI设计助手可用于分析你已经记录的测试现象、比较可能原因和修改方向；不要把AI生成的假设当成真实测试结果。',
    prompt_context:'正式主项目W5：V1测试与证据解释。只依据学生提供的实际测试现象帮助分析，不得虚构测试结果；需要区分观察事实、解释和待验证假设。',
  },
  {
    id:'W6', order:6, date:'10/26',
    title:'辅助绘画装置：根据证据制定修改计划', subtitle:'证据 → 判断 → 修改决定',
    student_label:'第6课 · 正式主项目', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false, carry_from:'W5',
    brief:[
      '重新查看V1的测试证据和原有设计标准。',
      '决定哪些部分保留、哪些部分修改，并解释每一个重要修改为什么值得做。',
      '这是本项目最重要的“依据证据做决定”阶段之一。',
    ],
    requirements:[
      '每个重要修改尽量对应一条测试证据、使用者需要或设计标准。',
      '不要一次改掉所有东西；优先处理最影响核心功能的问题。',
      '形成清楚、下一节能够直接实施的V2修改计划。',
    ],
    fields:[
      field('keep','哪些部分准备保留？对应什么证据或标准？'),
      field('revise','哪些部分准备修改？对应什么测试问题？'),
      field('revision_options','至少比较两种可能的修改办法：各自有什么优点和风险？'),
      field('revision_plan','最终决定怎样改成V2？为什么选这个办法？'),
    ],
    artifacts:[artifact('revision_plan_image','上传修改计划草图 / 标注图',{required:false})],
    ai_instruction:'AI设计助手可用于解释证据、比较修改方案、检查理由是否充分；最终修改选择由你完成。',
    prompt_context:'正式主项目W6：基于V1证据制定V2修改计划。重点是把测试证据、设计判断和修改决定连接起来；修改方案仍应优先在共同材料银行内可实现。',
  },
  {
    id:'W7', order:7, date:'11/16',
    title:'辅助绘画装置：完成第二版关键改进', subtitle:'按修改计划做实质变化｜仍以可测试为目标',
    student_label:'第7课 · 正式主项目', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false, carry_from:'W6',
    brief:[
      '根据W6的修改计划完成第二版原型（V2）。',
      '只要关键改进能够实施和再次测试即可，不需要把时间花在装饰和精加工上。',
    ],
    requirements:[
      '至少完成一个基于V1测试证据的实质修改。',
      '如果制作过程中改变原计划，要说明出现了什么新情况。',
      '保存V2照片；制作时AI是可用资源，但不要求为了聊天打断实际制作。',
    ],
    fields:[
      field('major_change','V2相较V1最重要的变化是什么？'),
      field('change_reason','这项变化对应哪条证据、需要或限制？'),
      field('plan_change','制作中有没有改变W6计划？如果有，为什么？',{required:false}),
    ],
    artifacts:[artifact('v2_photo','上传第二版作品照片')],
    ai_instruction:'AI设计助手可用于解决具体材料/结构问题或检查修改是否对应证据；制作时无需持续与AI交流。',
    prompt_context:'正式主项目W7：V2制作。以落实关键修改并保持可测试性为目标，不追求成品化。',
  },
  {
    id:'W8', order:8, date:'11/23',
    title:'辅助绘画装置：第二版再测试与项目总结', subtitle:'比较第一版和第二版的证据｜提交后完成后测',
    student_label:'第8课 · 正式主项目', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false, carry_from:'W7', questionnaire_slot:'post', questionnaire_after_submit:true,
    brief:[
      '使用与V1尽量一致的测试逻辑重新检查V2，并比较两版的证据。',
      '说明哪些问题确实改善了、哪些仍然存在，以及证据是否足够支持你的判断。',
      '提交正式主项目记录后完成学业求助意图后测。',
    ],
    requirements:[
      '记录V2的实际测试结果。',
      '用证据说明V1→V2发生了什么变化，不把“我觉得更好”当作唯一依据。',
      '上传最终作品和必要测试证据；研究重点不是外观是否精致。',
    ],
    fields:[
      field('v2_test_result','V2测试中实际发生了什么？'),
      field('comparison','与V1相比，哪些方面改善、没有改善或仍不能确定？请写依据。'),
      field('remaining_problem','如果还能继续改，你最想解决什么？为什么？',{required:false}),
      field('project_reflection','回看整个项目，哪一次证据或反馈最改变你的设计判断？',{required:false}),
    ],
    artifacts:[artifact('final_prototype','上传最终作品 / 第二版测试照片')],
    ai_instruction:'AI设计助手可用于比较V1/V2证据和梳理判断；AI不能替你虚构改进效果。',
    prompt_context:'正式主项目W8：V2再测试、V1/V2证据比较与项目总结。只依据真实记录帮助判断，不得虚构改善结果。',
  },
  {
    id:'W9', order:9, date:'11/30',
    title:'迁移任务：辅助书写装置（一）', subtitle:'撤除支持｜新情境中的理解、标准与构思',
    student_label:'第9课 · 迁移任务', research_role:'transfer', phase:'transfer', ai_mode:'free', candidate:false,
    source_course:'TeachEngineering: Helping Hands: Engineering Solutions for Multiple Sclerosis',
    brief:['新任务：为因手部抖动、力量不足或精细动作困难而难以稳定握笔的人设计一种辅助书写装置。','今天先理解新情境、明确标准与限制，并形成多个方案。'],
    requirements:['装置应能较稳定地固定铅笔。','容易穿戴、使用和取下。','材料与结构尽量低成本、可制作。','至少形成两个方案并说明选择依据。','两组现在都使用相同普通AI，不再提供实验性支持。'],
    fields:[field('transfer_need','新使用者最关键的困难是什么？'),field('transfer_criteria','你准备怎样判断装置是否有效？'),field('transfer_ideas','记录至少两个方案'),field('transfer_choice','目前选择哪个方案？为什么？')],
    artifacts:[artifact('transfer_sketch','上传迁移任务初步草图')],
    prompt_context:'迁移期第1周。所有学生统一普通AI。任务改编自TeachEngineering Helping Hands，重点是新情境中的需求、criteria/constraints与构思。',
  },
  {
    id:'W10', order:10, date:'12/7',
    title:'迁移任务：辅助书写装置（二）', subtitle:'制作、测试并记录证据',
    student_label:'第10课 · 迁移任务', research_role:'transfer', phase:'transfer', ai_mode:'free', candidate:false, carry_from:'W9',
    brief:['根据上周方案制作并测试辅助书写装置。','尝试实际书写，记录是否稳定、是否容易使用以及出现的问题。'],
    requirements:['保存原型照片。','记录至少一条真实测试证据。','两组继续使用相同普通AI。'],
    fields:[field('transfer_test_goal','这次主要测试什么？'),field('transfer_test_result','测试时实际发生了什么？'),field('transfer_problem','最需要改进的问题是什么？')],
    artifacts:[artifact('transfer_v1','上传迁移任务原型 / 测试照片')],
    prompt_context:'迁移期第2周。所有学生统一普通AI，围绕真实制作与测试问题提供普通帮助。',
  },
  {
    id:'W11', order:11, date:'12/14',
    title:'迁移任务：辅助书写装置（三）', subtitle:'评价、修改、再测试并完成',
    student_label:'第11课 · 迁移任务', research_role:'transfer', phase:'transfer', ai_mode:'free', candidate:false, carry_from:'W10',
    brief:['根据测试结果修改设计并再次测试。','完成迁移任务最终方案。'],
    requirements:['说明修改依据。','再次测试后判断是否改善。','上传最终方案/原型。','两组仍使用相同普通AI。'],
    fields:[field('transfer_revision','你修改了什么？为什么？'),field('transfer_retest','再次测试结果如何？'),field('transfer_reflection','这次新任务中，你是怎样获得和使用帮助的？',{required:false})],
    artifacts:[artifact('transfer_final','上传迁移任务最终原型 / 方案')],
    prompt_context:'迁移期第3周。所有学生统一普通AI，观察撤除支持后的近迁移与保持。',
  },
  {
    id:'W12', order:12, date:'12/21',
    title:'展示准备与访谈', subtitle:'整理作品｜制作展示说明｜完成研究访谈',
    student_label:'第12课 · 展示准备', research_role:'interview', phase:'interview', ai_mode:'none', candidate:false,
    brief:['整理正式主项目与迁移任务的作品和过程记录。','准备全校展示需要的说明纸/海报。','按老师安排完成刺激回忆或半结构访谈。'],
    requirements:['展示说明至少包含：为谁设计、解决什么问题、装置怎么使用、经历过什么重要修改。','访谈按真实经历回答，没有标准答案。'],
    fields:[field('display_message','你最想在展示中向观众说明什么？',{required:false}),field('interview_note','访谈/展示准备备注',{required:false})],
    artifacts:[artifact('display_draft','上传展示说明纸/海报草稿',{required:false})],
    prompt_context:'',
  },
  {
    id:'W13', order:13, date:'展示日',
    title:'全校成果展示', subtitle:'装置 + 展示说明｜课程成果归档',
    student_label:'第13课 · 全校展示', research_role:'presentation', phase:'presentation', ai_mode:'none', candidate:false,
    brief:['在全校展示中，一名学生可拿着装置，另一名学生举展示说明纸/海报，共同介绍设计。','本课主要用于课程成果展示与最终档案，不作为新的干预测量。'],
    requirements:['清楚说明使用者、真实需要、装置功能与一次重要修改。','保存最终装置与展示材料照片。'],
    fields:[field('presentation_summary','最终展示一句话介绍',{required:false})],
    artifacts:[artifact('final_device_photo','上传最终装置展示照片',{required:false}),artifact('final_poster_photo','上传展示说明纸/海报照片',{required:false})],
    prompt_context:'',
  },
];

export function getSessionConfig(id) { return SESSIONS.find(s => s.id === id) || null; }

export function aiVariantFor({ session, condition, isTest = false }) {
  if (!session || session.ai_mode === 'none') return 'none';
  if (session.ai_mode === 'free') return 'free';
  if (session.ai_mode === 'condition') {
    if (condition === 'A') return 'supported';
    if (condition === 'B') return 'free';
    if (isTest) return condition === 'A' ? 'supported' : 'free';
    return 'unassigned';
  }
  return 'free';
}

export function hiddenAiContext(session) {
  const studentMustSupplyContext = ['intervention','transfer'].includes(String(session?.phase || session?.research_role || ''));
  if (studentMustSupplyContext) {
    return [
      '【AI可见信息边界：学生需自行提供任务背景】',
      '你正在帮助一名初中生完成课堂中的开放式设计任务。',
      '不要从平台隐藏信息中获得、推断或补全具体任务主题、使用者特征、材料范围、设计要求、学生当前进展或课堂已经讲过的内容。',
      '只有学生在聊天中明确说出的信息、学生此前在同一AI对话中已经说过的信息，以及学生主动上传且图片中真正可见的信息，才可以作为当前任务事实。',
      '如果学生使用“这个”“这类人”“这个装置”“怎么做”等指代，但当前AI对话中没有足够前文说明对象，不要猜测其指代，也不要替学生补全课堂任务背景；应按普通对话所需程度请求必要信息。',
      '实验组与对照组都遵守这一信息边界。区别只来自各自智能体的人设与求助支持规则，不来自额外任务背景。',
      '共同事实约束：不得把学生未提供的材料、结构、测试结果、使用者反馈、数据或观察结果当作已知事实。信息不足时应明确说明目前无法确定。',
      '不要主动诱导学生求助，也不要要求学生采用固定提问模板。',
    ].join('\n');
  }
  return [
    '【课堂任务上下文：只用于帮助AI理解当前任务，不要把这段文字原样复述给学生，也不要把它变成固定提问脚本。】',
    `课次：${session.id} ${session.title}`,
    `研究阶段：${session.phase || session.research_role || ''}`,
    `任务说明：${session.brief.join(' ')}`,
    `任务要求：${session.requirements.join(' ')}`,
    session.prompt_context || '',
    '共同事实约束：不得把课堂任务资料中未提供的具体数字、比例、时长、调查结果、效果量或研究结论当作已知事实编造。若资料不足，应明确说明“当前资料无法确认”，可以建议需要补充什么证据；如果只是提出假设或示例，必须明确标成假设/示例。实验组与对照组都遵守这一基础规则。',
    session.ai_instruction ? `本节AI使用安排：${session.ai_instruction}` : 'AI使用安排以学生端本节要求为准。',
    '不要主动诱导学生求助，也不要要求学生采用固定提问模板。',
  ].filter(Boolean).join('\n');
}
