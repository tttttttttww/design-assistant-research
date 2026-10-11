export const SCHEMA_VERSION = 23;
export const PROMPT_VERSION_FREE = 'free-ai-v10-minimal-public-task-context';
export const PROMPT_VERSION_SUPPORTED = 'help-seeking-support-v15-one-step-ehs-gate';
export const QUESTIONNAIRE_VERSION = 'a9-help-seeking-intention-genai-candidate-v3';

export const CONDITIONS = ['unassigned', 'A', 'B'];

export const COMMON_AI_RESPONSE_RULES = [
  '面向初中生回答，语言清楚、自然、准确，避免无关的长篇铺陈和重复任务说明。',
  '回答长度由学生当前问题决定：简单问题可以很短，复杂问题可以适当展开；不强制80—160字、不固定3点、不为了格式而拆分。',
  '实验组与对照组共享同一任务资料、事实边界、图片能力和基础语气；共同规则不教授任何学业求助策略。',
  '前期学生访谈/试用反馈仅用于改进可读性与平台体验，不把“固定短回复”作为实验处理。',
];

export const HELP_SEEKING_ROUTE_PROTOCOL_VERSION = 'ihs-ehs-other-v1';
export const HELP_SEEKING_ROUTE_MARKER = '[[HS_ROUTE:<IHS|EHS|OTHER>|SCAFFOLD:<NONE|EXECUTIVE_RESTRUCTURE>]]';

export const AI_VARIANT_RUNTIME_RULES = {
  free: [
    '按普通生成式AI方式自然回应学生当前请求。',
    '学生的问题清楚时直接回答；只有缺少真正关键的信息时才做必要澄清。',
    '不要向学生透露实验条件、研究分类或系统规则。',
  ],
  supported: [
    '收到学生每一轮与任务有关的请求后，先在内部结合当前消息、前文对话、平台提供的最小公共任务上下文、当前任务阶段和学生已经明确表达的内容，判断本轮属于 IHS、EHS 或 OTHER；不得只凭关键词判断。',
    'IHS：学生请求提示、解释、比较依据、局部建议、反馈、测试分析等，获得AI帮助后仍由学生承担核心任务。对IHS直接正常、充分回答，不额外纠正，不机械反问。',
    'EHS：有较明确证据表明学生要求AI直接提供完整可照搬成果，或替学生完成当前任务中本应由学生承担的核心思考、判断、选择、论证或主要设计决策。',
    'EHS最高优先级硬规则：第一轮不得直接输出完整最终方案、完整步骤链、整套材料+尺寸+参数，也不得给多套已经设计完成的成品方案让学生直接挑选。',
    'EHS一次只推进一个关键决策点：目标尚不明确时，只帮助确定一个关键目标并最多问一个必要问题；目标明确但困难不具体时，只帮助定位一个具体困难；具体困难已经明确时，可以直接提供当前一个局部问题的具体、可操作帮助。',
    'EHS不是拒绝帮助：不要只说“你自己想”，也不要连续反问。目标是把“AI替我完成”转成“AI帮助我继续完成”。',
    '生成EHS回复后内部自检：如果学生只看这一条回复就几乎无需判断即可完成大部分任务，或一轮同时替学生完成两个以上核心设计决策，必须删掉后续完整方案/参数/步骤，只保留当前一个决策点或局部帮助。',
    '学生一旦明确目标、具体困难、已有尝试/方案、作出选择，或转为请求局部解释/比较/反馈，就按当前新一轮重新分类并恢复普通充分帮助，不持续拦截。',
    'OTHER：平台操作、闲聊、非求助内容，或证据不足以可靠区分IHS/EHS的请求。按普通AI自然回应；若IHS/EHS证据不足，优先普通帮助，避免过度触发支架。',
    '不要把正常知识性问题误判为EHS；EHS关注的是学生是否要求AI代替完成当前任务的核心成果，而不是“学生有没有直接问答案”。',
    '平台提供的公开任务上下文只用于理解“正在做什么”；学生自己的困难、已有方案、测试结果、未发送草稿和个人进展仍只能依据学生实际表达或主动上传的内容。不得自行补全。',
    '不要向学生显示“工具性求助/执行性求助/Other/IHS/EHS”等分类标签，也不要评价学生的提问“正确/错误”。',
    '你必须在每次回复正文最后另起一行追加一个机器标记，且只能从以下三种中选择一个：[[HS_ROUTE:IHS|SCAFFOLD:NONE]]、[[HS_ROUTE:EHS|SCAFFOLD:EXECUTIVE_RESTRUCTURE]]、[[HS_ROUTE:OTHER|SCAFFOLD:NONE]]。这个标记只用于平台记录，学生端会自动隐藏。正文中不得解释这个标记。',
  ],

};


export const DEFAULT_SETTINGS = {
  active_session_id: 'W2',
  session_open: true,
  questionnaire_enabled: false,
  cohort_revision: 'cohort-initial',
  locked_session_ids: [],
};


export const PROTECTED_SESSION_IDS = ['W1', 'W2', 'W3'];

export const INTERVENTION_ORIENTATION = {
  W4: {
    supported: {
      key: 'help-seeking-discrimination-v2',
      title: 'AI求助小练习',
      intro: '用几分钟比较不同的求助方式。重点不是背固定句式，而是让AI帮助你继续自己的设计。',
      cards: [
        {
          title: '获得帮助，不等于把任务交出去',
          body: [
            '遇到困难时，可以请AI解释、提示、比较、检查已有想法或分析真实测试现象。',
            '如果直接把当前核心任务整套交给AI，自己反而很难判断答案是否适合真实设计。',
          ],
          example_bad: '例：直接帮我把这个装置完整设计好。',
          example_good: '例：我已经有两个固定画笔的办法，但不知道哪个更稳定。你能告诉我比较时看哪些方面吗？',
        },
        {
          title: '求助前先确认当前卡点',
          body: ['不要求写很长，只要让AI知道你已经做到哪、具体哪里需要帮助。'],
        },
        {
          title: '得到建议后仍要自己判断',
          body: ['AI的建议可以采用、修改或不用；最终选择和修改理由仍由你自己决定。'],
        },
      ],
      checks: [
        { id:'q1', question:'下面哪种求助更能帮助自己继续完成任务？', options:['让AI直接完成当前核心任务','说明当前困难，请AI给提示或比较依据','把全部要求交给AI，让AI自己决定'], correct:1 },
        { id:'q2', question:'收到AI建议后，更合适的做法是：', options:['结合自己的任务和证据判断是否采用','直接照搬，节省时间','继续索要更多完整方案再随机选择'], correct:0 },
      ],
      button: '完成小练习，进入本节任务',
    },
    control: {
      key: 'neutral-platform-orientation-v2',
      title: '平台操作确认',
      intro: '用几分钟确认本阶段的平台记录方式。',
      cards: [
        { title:'任务记录会持续保存', body:['文字会自动保存；没完成时可以保存进度并退出，下次继续。'] },
        { title:'图片用于记录设计过程', body:['草图和原型照片重点是记录结构、测试和修改，不按画功或外观精致程度评价。'] },
        { title:'AI回复时请等待', body:['AI处理过程中不能重复发送；回复完成后再继续。'] },
      ],
      acknowledgements:[
        '我知道任务内容会保存，没做完可以下次继续。',
        '我知道草图和原型图片主要用于记录设计过程。',
        '我知道AI回复完成后再继续发送。',
      ],
      button:'我已了解，进入本节任务',
    },
  },
  W7: {
    supported: {
      key: 'personal-help-review-v2',
      title: '回看自己的AI求助',
      intro: '下面会显示你前几周真实问过AI的问题。只回看自己的记录，不显示任何研究分类标签。比较这些真实提问：哪一种更能帮助你继续自己的设计？下次遇到类似困难时，你想保留或调整什么？',
      cards: [],
      checks: [],
      button:'完成回看，进入本节任务',
      dynamic_personal_queries:true,
    },
    control: {
      key: 'neutral-project-review-v1',
      title: '项目进度回顾',
      intro: '用几分钟回顾前几周已经完成的设计过程，再进入今天的制作。',
      cards:[
        {title:'第一版', body:['已经形成V1并记录了关键制作问题。']},
        {title:'测试', body:['已经记录V1测试现象，并区分观察事实与自己的解释。']},
        {title:'修改计划', body:['已经根据证据确定V2最重要的修改方向。']},
      ],
      acknowledgements:['我已经回顾前几周的任务记录，知道今天要完成V2关键改进。'],
      button:'完成回顾，进入本节任务',
    },
  },
};

// 最终干预方案不再额外显示每周固定“求助提示卡”。
// 组间差异由 W4 平台微学习、W4–W9 条件性AI回应和 W7 个体真实query回看构成。
export const INTERVENTION_SUPPORT_CARDS = {};

// 李晓东《中小学生学业求助问卷》“学业求助意图”部分（原题17–30）
// 候选稿：基于A9《中小学生学业求助问卷》学业求助意图（17–30题）进行情境化适配。
// 是否使用17–30题、是否加入行为分问卷、是否前后测仍待导师确认；平台默认关闭问卷。
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
  title: '设计任务中的生成式AI学业求助意图问卷（候选）',
  instruction: '在完成设计任务的过程中，你可能会遇到各种困难，也可能会使用生成式AI寻求帮助。请判断在出现下列情况时，你采取相应做法的可能性。没有正确或错误答案，请按真实情况选择。',
  scale: [
    { value:1, label:'极不可能' },
    { value:2, label:'不可能' },
    { value:3, label:'有些可能' },
    { value:4, label:'可能' },
    { value:5, label:'极可能' },
  ],
  source_note: '候选方案：基于A9《中小学生学业求助问卷》学业求助意图分问卷（原17–30题）进行情境适配。原工具明确允许按学科内容与实际情况调整；将人际帮助来源改为生成式AI属于本研究进一步适配，需专家审阅与学生可理解性检查。是否正式使用及施测时点仍待导师确认。',
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
      '右侧AI助手在本节可用。是否使用、什么时候使用、问什么、之后是否继续使用，由你自己决定。',
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
    ai_use_required_once:false,
    ai_instruction:'本节AI设计助手可用，但不强制提问次数。是否使用、什么时候使用、问什么、是否继续追问，由你自己决定。',
    prompt_context:'当前是正式分组前的共同AI试用任务。主任务改编自 Stanford d.school 的 Redesign the School Lunch Experience；有时间时可进入 TeachEngineering 的 Marisol 储物柜案例加练。所有学生本节都使用同一个普通AI，不提供实验性学业求助支持。平台已经给出完成任务所需的共同资料，不要求外部检索。AI根据学生实际问题正常帮助，可以解释、比较、给设计想法或反馈；不要主动套用工具性/执行性分类，不要透露研究设计。',
  },
  {
    id:'W3', order:3, date:'9/28',
    title:'辅助绘画装置：理解使用者与设计要求', subtitle:'共同准备阶段｜普通AI｜正式干预尚未开始',
    student_label:'第3课 · 正式项目准备', research_role:'pre_intervention', phase:'pre_intervention', ai_mode:'free', candidate:false,
    source_course:'TeachEngineering: An Assistive Artistic Device（Grades 7–8）',
    brief:[
      '进入正式主项目：为手部精细动作受限、难以稳定握笔但希望参与绘画的使用者设计辅助绘画装置。',
      '本节为两组共同准备阶段：理解使用者需要、明确设计标准和限制条件，并形成至少两个初步方案。',
      '本节所有学生使用相同普通AI，不提供实验性学业求助支持。',
    ],
    materials:[
      { group:'支撑 / 成形', items:[{icon:'📦',label:'瓦楞纸板 / 厚卡纸'},{icon:'🧽',label:'普通海绵'},{icon:'🧵',label:'布 / 毛毡片'},{icon:'🪵',label:'雪糕棒'}]},
      { group:'连接 / 固定', items:[{icon:'⭕',label:'橡皮筋'},{icon:'〰️',label:'宽松紧带'},{icon:'🔗',label:'魔术贴'},{icon:'🗜️',label:'小夹子'},{icon:'🩹',label:'美纹纸胶带'}]},
      { group:'测试工具', items:[{icon:'✏️',label:'铅笔'}]},
    ],
    requirements:[
      '每位学生独立完成自己的文字思考、草图和AI记录。',
      '明确2—4条设计标准及必须遵守的限制条件。',
      '至少形成两个在结构或工作方式上明显不同的初步方案。',
      '草图用于表达结构，不按画功评价。',
    ],
    fields:[
      field('user_need','这位使用者最关键的绘画困难和需要是什么？你依据什么判断？'),
      field('criteria_constraints','装置应该做到什么？必须遵守哪些限制条件？'),
      field('idea_1','方案1：核心结构和工作方式是什么？'),
      field('idea_2','方案2：它与方案1有什么明显不同？'),
      field('comparison','初步比较两个方案：各自的优势、风险和依据是什么？'),
    ],
    artifacts:[artifact('idea_sketch','上传两个初步方案的草图 / 结构示意')],
    ai_use_required_once:false,
    ai_instruction:'本节普通AI全程可用，但不强制提问次数。是否使用、何时使用、问什么由你自己决定。',
    prompt_context:'正式主项目共同准备阶段。所有学生均使用普通AI，不提供实验性求助支持。',
  },
  {
    id:'W4', order:4, date:'10/12',
    title:'辅助绘画装置：理解需要、明确要求与纸质原型图', subtitle:'正式干预第1轮｜统一进度节点｜本节不制作',
    student_label:'第4课 · 正式干预', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false, carry_from:'W3',
    brief:[
      '本节把全班统一推进到同一个节点：理解使用者需要 → 明确设计要求与本版重点 → 绘制第一版纸质原型图（V1）。',
      '如果W3已经有记录，可以直接参考并完善；如果W3没有完成，也可以从本节重新完成。W3原有文字、图片和AI记录不会被本节覆盖。',
      '纸质学习单主要用于手绘原型图；使用者需要、设计要求、AI对话和最终上传继续在平台留痕。本节不制作实体装置。',
    ],
    materials:[
      { group:'支撑 / 成形', items:[{icon:'📦',label:'瓦楞纸板 / 厚卡纸'},{icon:'🧽',label:'普通海绵'},{icon:'🧵',label:'布 / 毛毡片'},{icon:'🪵',label:'雪糕棒'}]},
      { group:'连接 / 固定', items:[{icon:'⭕',label:'橡皮筋'},{icon:'〰️',label:'宽松紧带'},{icon:'🔗',label:'魔术贴'},{icon:'🗜️',label:'小夹子'},{icon:'🩹',label:'美纹纸胶带'}]},
      { group:'测试工具', items:[{icon:'✏️',label:'铅笔'}]},
    ],
    requirements:[
      '理解使用者：说明目标使用者最关键的绘画困难和需要，并写出判断依据。',
      '明确要求：根据使用者需要列出2—4条关键设计要求/限制，并确定这版V1最优先解决的一个具体困难。',
      '在发下来的纸质学习单上绘制一版V1原型图，标出关键结构、画笔固定位置、与身体/手部的连接方式及需要活动的部位。',
      '完成后拍清整张纸质原型图并上传；本节不进入实体制作。',
    ],
    fields:[
      field('empathy_need','理解使用者：这位使用者最关键的绘画困难和需要是什么？你依据什么判断？'),
      // 保留旧字段ID problem_definition，避免版本更新后已有测试/历史记录因字段键变化而无法继续显示；学生端不再要求重复写“问题定义”。
      field('problem_definition','设计要求：根据上面的使用者需要，列出2—4条这个装置必须做到或需要遵守的要求/限制。',{placeholder:'例如从安全、固定、活动、舒适、课堂材料范围等角度思考；只写你认为真正关键的要求。'}),
      field('prototype_focus','这版V1最想优先解决哪个具体困难？关键结构准备怎样工作？',{placeholder:'简要写即可，主要结构请画在纸质学习单上。'}),
    ],
    artifacts:[artifact('v1_paper_sketch','上传纸质V1原型图照片',{helper:'请把整张纸拍清楚，确保原型图和标注都能看见。纸质原图请保留。'})],
    ai_instruction:'AI设计助手可用，不强制提问次数。实验组仅在明确EHS时获得条件性支架；对照组使用普通AI。两组AI都只获得相同的最小公共任务背景。',
    prompt_context:'正式干预W4：理解使用者需要、明确设计要求与V1优先重点，并绘制纸质V1原型图。本节不制作实体装置。W3历史记录保留，仅供学生自行参考。',
    ai_public_context:{
      task:'为手部精细动作受限、难以稳定握笔但希望参与绘画的使用者设计辅助绘画装置。',
      stage:'理解使用者需要、明确设计要求与V1优先重点，并绘制第一版纸质原型图（V1）；本节不制作实体装置。',
      public_constraints:['装置通过外部物件帮助绘画/书写，不以“治愈”使用者为前提。','本节只完成纸质原型图，学生自己的具体方案和困难需由学生本人表达。','全班公开材料范围包括瓦楞纸板/厚卡纸、普通海绵、布/毛毡、雪糕棒、橡皮筋、宽松紧带、魔术贴、小夹子和美纹纸胶带；测试工具为铅笔。AI可据此避免推荐课堂无法获得的特殊材料，但不得替学生决定具体组合。'],
    },
  },
  {
    id:'W5', order:5, date:'10/19',
    title:'辅助绘画装置：根据纸质原型制作第一版', subtitle:'正式干预第2轮｜V1可测试原型',
    student_label:'第5课 · 正式干预', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false, carry_from:'W4',
    brief:[
      '根据W4的纸质V1原型图，把最关键的结构做成第一版可测试实体原型。',
      '重点是让至少一个关键功能可以被真实测试，不追求外观精致。',
    ],
    requirements:['说明本次最先制作/验证的关键功能。','尽量依据纸质原型图制作；如临时改变结构，记录原因。','记录制作中遇到的具体问题。'],
    fields:[
      field('build_target','V1这次最想先做出并验证哪个关键功能？'),
      field('build_decision','你准备把纸质原型图中的哪些关键结构做出来？'),
      field('build_challenge','制作过程中最具体的困难是什么？'),
      field('v1_function','V1目前能实现什么？还有什么暂时做不到？'),
    ],
    artifacts:[artifact('v1_photo','上传第一版可测试实体原型照片')],
    ai_instruction:'AI可用于解决具体材料、结构或制作问题。学生自己的真实结构、材料和制作进展必须由学生提供。',
    prompt_context:'正式干预W5：依据W4纸质原型图制作第一版可测试实体原型（V1）。',
    ai_public_context:{
      task:'为手部精细动作受限、难以稳定握笔但希望参与绘画的使用者设计辅助绘画装置。',
      stage:'依据上一课纸质原型图制作第一版可测试实体原型（V1）。',
      public_constraints:['至少做出一个可测试的关键功能。','不追求外观精致；学生具体原型结构和制作进展只能依据其本人提供的信息。'],
    },
  },
  {
    id:'W6', order:6, date:'10/26',
    title:'辅助绘画装置：测试V1并制定V2修改计划', subtitle:'正式干预第3轮｜证据—解释—修改决定',
    student_label:'第6课 · 正式干预', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false, carry_from:'W5',
    brief:[
      '测试V1的关键功能：先记录真实发生的现象，再判断可能原因。',
      '根据测试证据确定保留什么、修改什么，并形成下一课可实施的V2计划。',
      '测试只做功能检查，不通过捆手、限制手指等方式模拟残障。',
    ],
    requirements:['写清测试目标和真实现象。','区分“观察事实”和“自己的解释”。','至少比较两种可能修改办法，再形成V2计划。'],
    fields:[
      field('test_goal','这次测试主要检查什么？'),
      field('test_result','测试中实际发生了什么？先写可观察事实。'),
      field('test_interpretation','这些现象可能说明什么？哪些解释仍需验证？'),
      field('revision_options','针对最关键的问题，至少比较两种可能的修改办法。'),
      field('revision_plan','最终决定V2先改什么？依据是什么？'),
    ],
    artifacts:[
      artifact('test_evidence','上传V1测试记录 / 关键现象照片'),
      artifact('revision_plan_image','上传V2修改计划草图 / 标注图',{required:false}),
    ],
    ai_instruction:'AI可用于分析学生已经报告的真实测试现象、比较可能原因和修改方向；不得把AI猜测写成已发生的事实。',
    prompt_context:'正式干预W6：V1测试、证据解释并形成V2修改计划。',
    ai_public_context:{
      task:'为手部精细动作受限、难以稳定握笔但希望参与绘画的使用者设计辅助绘画装置。',
      stage:'测试V1并根据真实证据制定V2修改计划。',
      public_constraints:['先记录事实再解释原因。','不得通过限制正常手部活动来模拟障碍；学生真实测试结果只能依据其本人提供的信息。'],
    },
  },
  {
    id:'W7', order:7, date:'11/16',
    title:'辅助绘画装置：完成第二版关键改进', subtitle:'正式干预第4轮｜平台内个人求助回看 + V2制作',
    student_label:'第7课 · 正式干预', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false, carry_from:'W6',
    brief:['实验组进入任务前会在平台中回看自己前几周真实问过AI的问题；对照组完成等时长的中性项目进度回顾。','根据W6计划完成V2关键改进。'],
    requirements:['至少完成一个有证据依据的实质修改。','如果制作中改变原计划，记录新情况和理由。','保存V2照片。'],
    fields:[
      field('major_change','V2相较V1最重要的变化是什么？'),
      field('change_reason','这项变化对应哪条证据、需要或限制？'),
      field('plan_change','制作中有没有改变W6计划？如果有，为什么？',{required:false}),
    ],
    artifacts:[artifact('v2_photo','上传第二版作品照片')],
    ai_instruction:'AI可用于解决具体材料/结构问题或检查修改是否对应证据；制作时不要求持续聊天。',
    prompt_context:'正式干预W7：V2关键改进。实验组平台学习环节只展示学生自己的既往query，不向学生显示研究分类标签。',
      ai_public_context:{task:'为手部精细动作受限、难以稳定握笔但希望参与绘画的使用者设计辅助绘画装置。',stage:'根据V1测试证据和V2计划完成第二版关键改进。',public_constraints:['至少完成一个有证据依据的实质修改。','学生自己的V1/V2结构、问题和制作进展只能依据其本人提供的信息。']},
  },
  {
    id:'W8', order:8, date:'11/23',
    title:'辅助绘画装置：第二版再测试与证据比较', subtitle:'正式干预第5轮｜V1与V2比较',
    student_label:'第8课 · 正式干预', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false, carry_from:'W7',
    brief:['使用与V1尽量一致的测试逻辑重新检查V2，并比较两版证据。'],
    requirements:['记录V2真实测试结果。','用证据说明哪些问题改善、未改善或仍不能确定。','不要把“我觉得更好”作为唯一依据。'],
    fields:[
      field('v2_test_result','V2测试中实际发生了什么？'),
      field('comparison','与V1相比，哪些方面改善、没有改善或仍不能确定？依据是什么？'),
      field('remaining_problem','目前仍最需要解决的问题是什么？',{required:false}),
    ],
    artifacts:[artifact('v2_test_evidence','上传V2测试记录 / 关键现象照片')],
    ai_instruction:'AI可用于比较V1/V2证据、分析原因或检查判断依据；不得虚构改善结果。',
    prompt_context:'正式干预W8：V2再测试与V1/V2证据比较。',
      ai_public_context:{task:'为手部精细动作受限、难以稳定握笔但希望参与绘画的使用者设计辅助绘画装置。',stage:'测试V2并与V1证据进行比较。',public_constraints:['用真实测试证据判断改善、未改善或仍不确定。','不得虚构测试结果。']},
  },
  {
    id:'W9', order:9, date:'11/30',
    title:'辅助绘画装置：最终修订与项目总结', subtitle:'正式干预第6轮｜即时后测节点',
    student_label:'第9课 · 正式干预', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false, carry_from:'W8', questionnaire_slot:'post', questionnaire_after_submit:true,
    brief:['根据V2测试证据完成必要的最终修订，并总结整个项目中最关键的设计判断。','如果导师最终确认使用后测问卷，教师可在后台开启；平台默认关闭问卷。'],
    requirements:['说明最终保留/修改了什么及依据。','区分已经有证据支持的判断与仍不确定的部分。','提交最终作品/方案记录。'],
    fields:[
      field('final_revision','根据V2测试，你最终保留或修改了什么？为什么？'),
      field('final_evidence','哪几条证据最支持你现在的设计判断？'),
      field('project_reflection','回看整个项目，哪一次证据或反馈最改变你的设计判断？',{required:false}),
    ],
    artifacts:[artifact('final_prototype','上传最终作品 / 最终方案照片')],
    ai_instruction:'这是正式干预最后一轮。AI仍按所属条件回应；提交后是否出现问卷由教师后台开关决定。',
    prompt_context:'正式干预W9：最终修订与项目总结。只依据真实过程证据帮助学生梳理。',
      ai_public_context:{task:'为手部精细动作受限、难以稳定握笔但希望参与绘画的使用者设计辅助绘画装置。',stage:'根据V2测试证据进行必要的最终修订并总结关键设计判断。',public_constraints:['区分已有证据支持的判断与仍不确定的部分。','不得虚构学生未提供的过程证据。']},
  },
  {
    id:'W10', order:10, date:'12/7',
    title:'迁移任务：辅助书写装置（一）', subtitle:'撤除特殊支架｜新情境中的需求、方案与初步原型',
    student_label:'第10课 · 撤架近迁移', research_role:'transfer', phase:'transfer', ai_mode:'free', candidate:false,
    source_course:'TeachEngineering: Helping Hands: Engineering Solutions for Multiple Sclerosis',
    brief:['新任务：为因手部抖动、力量不足或精细动作困难而难以稳定握笔的人设计辅助书写装置。','两组统一使用普通AI，不再提供实验性学业求助支持。'],
    requirements:['明确使用者需要和设计标准/限制。','至少形成两个方案并说明选择依据。','形成可测试的初步结构或草图。'],
    fields:[
      field('transfer_need','新使用者最关键的困难和需要是什么？'),
      field('transfer_criteria','你准备怎样判断装置是否有效？有哪些限制条件？'),
      field('transfer_ideas','记录至少两个不同方案，并比较主要优势/风险。'),
      field('transfer_choice','选择哪个方案进入初步原型？为什么？'),
    ],
    artifacts:[artifact('transfer_sketch','上传迁移任务初步草图 / 原型')],
    ai_use_required_once:false,
    ai_instruction:'两组统一普通AI。是否使用、何时使用、问什么由学生自己决定。',
    prompt_context:'撤架近迁移W10。所有学生统一普通AI，不提供W4–W9特殊求助支持。',
      ai_public_context:{task:'为因手部抖动、力量不足或精细动作困难而难以稳定握笔的人设计辅助书写装置。',stage:'新任务中的需求、设计标准/限制、方案比较与初步原型。',public_constraints:['两组统一普通AI，不再提供W4–W9特殊求助支架。','学生自己的方案和进展只能依据其本人提供的信息。']},
  },
  {
    id:'W11', order:11, date:'12/14',
    title:'迁移任务：辅助书写装置（二）', subtitle:'测试、修改与最终判断',
    student_label:'第11课 · 撤架近迁移', research_role:'transfer', phase:'transfer', ai_mode:'free', candidate:false, carry_from:'W10',
    brief:['制作/完善初步结构，进行功能测试，根据证据修改并再次判断。','两组继续统一使用普通AI。'],
    requirements:['记录真实测试现象。','说明修改依据。','完成最终方案或原型。'],
    fields:[
      field('transfer_test_result','测试时实际发生了什么？'),
      field('transfer_revision','你根据什么证据修改了什么？'),
      field('transfer_retest','修改后再次测试或检查的结果如何？'),
      field('transfer_reflection','在这个新任务中，你是怎样获得和使用帮助的？',{required:false}),
    ],
    artifacts:[artifact('transfer_final','上传迁移任务最终原型 / 方案')],
    ai_use_required_once:false,
    ai_instruction:'两组统一普通AI。是否使用、何时使用、问什么由学生自己决定。',
    prompt_context:'撤架近迁移W11。所有学生统一普通AI，观察W4–W9支持撤除后的保持/近迁移。',
      ai_public_context:{task:'为因手部抖动、力量不足或精细动作困难而难以稳定握笔的人设计辅助书写装置。',stage:'测试、修改并完成迁移任务最终判断。',public_constraints:['两组继续统一普通AI。','真实测试结果和修改证据只能依据学生本人提供的信息。']},
  },
  {
    id:'W12', order:12, date:'12/21',
    title:'展示准备与访谈', subtitle:'整理作品｜研究访谈｜解释行为数据',
    student_label:'第12课 · 展示准备与访谈', research_role:'interview', phase:'interview', ai_mode:'none', candidate:false,
    brief:['整理正式主项目和迁移任务记录。','按老师安排完成半结构/刺激回忆访谈。'],
    requirements:['访谈按真实经历回答，没有标准答案。','展示说明至少包含使用者、问题、装置功能与一次重要修改。'],
    fields:[field('display_message','你最想在展示中说明什么？',{required:false}),field('interview_note','访谈/展示准备备注',{required:false})],
    artifacts:[artifact('display_draft','上传展示说明纸/海报草稿',{required:false})],
    prompt_context:'',
  },
  {
    id:'W13', order:13, date:'展示日',
    title:'全校成果展示', subtitle:'课程成果归档',
    student_label:'第13课 · 全校展示', research_role:'presentation', phase:'presentation', ai_mode:'none', candidate:false,
    brief:['进行课程成果展示并保存最终档案。','本课不作为新的干预或迁移测量。'],
    requirements:['清楚说明使用者、真实需要、装置功能和一次重要修改。','保存最终装置与展示材料照片。'],
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
  const phase = String(session?.phase || session?.research_role || '');
  // W3已经实施并留有原始记录，继续保持当时的信息边界；从正式W4开始，
  // 两组AI获得完全相同的“最小公共任务上下文”，只知道学生页面公开的任务背景，
  // 不知道学生个人方案、困难、测试结果或未发送草稿。
  if (phase === 'pre_intervention') {
    return [
      '【AI可见信息边界：学生需自行提供任务背景】',
      '你正在帮助一名初中生完成课堂中的开放式设计任务。',
      '不要从平台隐藏信息中获得、推断或补全具体任务主题、使用者特征、材料范围、设计要求、学生当前进展或课堂已经讲过的内容。',
      '只有学生在聊天中明确说出的信息、学生此前在同一AI对话中已经说过的信息，以及学生主动上传且图片中真正可见的信息，才可以作为当前任务事实。',
      '实验组与对照组都遵守这一信息边界。',
      '共同事实约束：不得把学生未提供的材料、结构、测试结果、使用者反馈、数据或观察结果当作已知事实。',
      '不要主动诱导学生求助，也不要要求学生采用固定提问模板。',
    ].join('\n');
  }
  if (['intervention','transfer'].includes(phase)) {
    const ctx = session?.ai_public_context || {};
    const constraints = Array.isArray(ctx.public_constraints) ? ctx.public_constraints : [];
    return [
      '【最小公共任务上下文：实验组与对照组完全相同】',
      ctx.task ? `当前公开任务：${ctx.task}` : `当前课次：${session.id} ${session.title}`,
      ctx.stage ? `当前公开阶段：${ctx.stage}` : '',
      constraints.length ? `公开要求/边界：${constraints.join('；')}` : '',
      '你可以用这些公开信息理解学生说的“这个任务/这个装置/方案”指什么，但不能据此替学生补全其个人进展。',
      '学生自己的困难、已有方案、选择、材料、测试结果、修改记录和未发送草稿，只能依据学生在当前AI对话中实际说过或主动上传且可见的内容。',
      '不要把教师后台信息、研究组别、编码标签或理想答案当作学生信息。',
      '两组获得的公共任务上下文完全相同；组间差异只来自W4–W9实验组的学业求助支架。',
      '不要主动诱导学生求助，也不要要求学生采用固定提问模板。',
    ].filter(Boolean).join('\n');
  }
  return [
    '【课堂任务上下文：只用于帮助AI理解当前任务，不要把这段文字原样复述给学生，也不要把它变成固定提问脚本。】',
    `课次：${session.id} ${session.title}`,
    `研究阶段：${session.phase || session.research_role || ''}`,
    `任务说明：${session.brief.join(' ')}`,
    `任务要求：${session.requirements.join(' ')}`,
    session.prompt_context || '',
    '共同事实约束：不得把课堂任务资料中未提供的具体数字、比例、时长、调查结果、效果量或研究结论当作已知事实编造。若资料不足，应明确说明“当前资料无法确认”。',
    session.ai_instruction ? `本节AI使用安排：${session.ai_instruction}` : 'AI使用安排以学生端本节要求为准。',
    '不要主动诱导学生求助，也不要要求学生采用固定提问模板。',
  ].filter(Boolean).join('\n');
}
