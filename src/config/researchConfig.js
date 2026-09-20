export const SCHEMA_VERSION = 14;
export const PROMPT_VERSION_FREE = 'free-ai-v3';
export const PROMPT_VERSION_SUPPORTED = 'help-seeking-support-v4-help-tutor-grounded';
export const QUESTIONNAIRE_VERSION = 'li-help-seeking-intention-genai-v2-minimal-adaptation';

export const CONDITIONS = ['unassigned', 'A', 'B'];

export const DEFAULT_SETTINGS = {
  active_session_id: 'W2',
  session_open: true,
  questionnaire_enabled: true,
  cohort_revision: 'cohort-initial',
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
    title:'重新设计学校午餐体验', subtitle:'共同AI试用任务｜先理解体验，再提出方案并根据新反馈修改',
    student_label:'第2课 · 共同试用', research_role:'pilot_trial', phase:'baseline', ai_mode:'free', candidate:false,
    source_course:'Stanford d.school: Redesign the School Lunch Experience',
    brief:[
      '今天你要重新设计的不是某一道菜，而是“学校午餐体验”：从下课、去食堂、了解当天选择、排队取餐、找座位、用餐，到最后离开。',
      '这是一个虚构但贴近日常学校生活的共同情境。所有同学看到相同资料，方便大家在同样条件下完成任务。',
      '任务改编自 Stanford d.school 的“Redesign the School Lunch Experience”。原活动通过访谈理解同伴需求；本节为了让所有同学获得一致信息，改用同一组午餐体验记录，但仍保留“发现需求—定义问题—构思—获得反馈—修改”的核心过程。',
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
        title:'资料B｜几段午餐体验记录',
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
        title:'资料C｜你现在可以改变什么',
        items:[
          '可以重新设计信息呈现方式、排队与取餐流程、座位和动线的使用方式，或加入简单可行的工具。',
          '方案不必解决资料里的所有问题，但要说清楚你优先解决谁的什么问题。',
          '方案需要兼顾学生体验和工作人员实际执行，不能只追求“看起来很酷”。',
          '没有唯一标准答案；重要的是你能说明“为什么这样判断、为什么这样取舍”。',
        ],
      },
    ],
    requirements:[
      '先根据共同资料自己形成第一版判断，不要一开始就让AI替你完成整套任务。',
      '完成第3题“第一版问题定义”后，请从你目前最不确定、最想比较或最需要反馈的一点中任选一个，与平台里的AI真实讨论至少1次；之后是否继续使用AI、问几次，由你自己决定。',
      '至少提出3个明显不同的解决方向，不能只是把同一个想法换名字、换颜色。',
      '先作出一次初步选择，再点击“查看新反馈”；看到新反馈后决定是否修改，不要求一定改。',
      '老师只处理登录、页面操作和任务规则问题；设计判断与方案由你自己完成，也可以和AI讨论。',
    ],
    fields:[
      field('evidence_needs','1. 从资料中找出3个你认为最值得关注的午餐体验问题或需要，并分别写出依据',{placeholder:'例如：你看到了什么现象？它说明谁遇到了什么问题？'}),
      field('core_problem','2. 如果这次只能优先解决一个问题，你会选哪一个？为什么它比其他问题更值得优先解决？',{placeholder:'不要只写“排队太长”。说明这个问题影响了谁、造成了什么体验。'}),
      field('problem_definition_v1','3. 写出你的第一版问题定义',{placeholder:'可以用自己的话写清：谁需要一种什么样的改善，因为你发现了什么关键问题或需要。',helper:'完成这一题后，请选择一个你真正不确定的地方，与右侧AI讨论至少一次，再继续下面的方案构思。'}),
      field('solution_directions','4. 提出3个明显不同的解决方向，并说明每个方向主要解决什么',{placeholder:'三个方向应该在“怎么解决”上有明显差别，而不是只改外观。'}),
      field('initial_choice','5. 先选出你目前最倾向的一个方向：它的主要优点是什么？可能有什么问题？为什么暂时选它？',{placeholder:'先做一次真实判断，不需要追求“标准答案”。'}),
      field('revision_decision','6. 【查看新反馈后填写】新反馈会不会改变你刚才的方案？哪些地方保留，哪些地方需要修改？为什么？',{stage:'after_update',placeholder:'可以选择修改，也可以选择不改；关键是说明新信息与你原方案之间的关系。'}),
      field('final_solution','7. 写出你的最终方案：它怎样改善午餐体验，又怎样考虑学生、工作人员和现实限制？',{stage:'after_update',placeholder:'用简洁文字说明核心做法和取舍。'}),
    ],
    mid_task_update:{
      title:'第二轮｜收到新的学校反馈',
      intro:'先完成前5题并作出初步选择，再查看下面的新反馈。设计师经常需要在新条件出现后重新检查原来的判断。',
      button:'我已经完成初步选择，查看新反馈',
      after_fields:['evidence_needs','core_problem','problem_definition_v1','solution_directions','initial_choice'],
      items:[
        '学校确认：午餐时段不能延长，本学期也不能增加服务窗口或额外增加工作人员。',
        '学生在校期间不能依赖个人手机完成点餐、预约或取餐操作。',
        '新的学生反馈显示：大家希望提高效率，但不接受“为了更快而只剩一种固定选择”的做法。',
        '因此，新方案需要在“效率、选择感和现实可执行性”之间重新权衡。',
      ],
    },
    artifacts:[artifact('lunch_solution_sketch','如果你画了午餐流程图、空间草图或方案示意，可以上传',{required:false})],
    ai_use_required_once:true,
    ai_instruction:'本节是共同AI试用任务。完成第一版问题定义后，请选择一个你真正不确定、最想比较或最需要反馈的地方，与AI讨论至少1次；之后是否继续使用由你决定。',
    prompt_context:'当前是正式分组前的共同AI试用任务，改编自 Stanford d.school 的 Redesign the School Lunch Experience。所有学生本节都使用同一个普通AI，不提供实验性学业求助支持。平台已经给出统一午餐情境资料，不需要外部检索。AI根据学生实际问题正常帮助，可以解释、比较、给设计想法或反馈；不要主动套用工具性/执行性分类，不要透露研究设计。',
  },
  {
    id:'W3', order:3, date:'9/28',
    title:'辅助绘画装置：明确标准并进行多方案构思', subtitle:'补充研究｜建立criteria/constraints｜形成至少两个不同方案',
    student_label:'第3课 · 正式主项目', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false,
    brief:[
      '正式主项目从本节开始：先阅读辅助绘画装置的使用者情境，理解手部精细动作困难可能带来的不同影响。',
      '先区分“已经知道什么”和“还需要了解什么”，再形成初步问题定义与设计标准。',
      '在此基础上发散构思，至少形成两个明显不同的方案，再比较它们。',
    ],
    requirements:[
      '项目基本限制：原型必须安全、能够在课堂条件下制作和测试，并能帮助使用者使用一种常见绘画工具。',
      '根据本节对使用者情境的理解，提出2—4条与真实需要有关的设计标准。',
      '至少形成两个结构或工作方式明显不同的方案，而不是只改颜色或外观。',
      '依据设计标准比较两个方案，并说明目前的选择依据。',
    ],
    fields:[
      field('evidence','关于这个使用者情境，你目前知道什么？还需要进一步了解什么？'),
      field('criteria_constraints','根据使用者需要和项目基本限制，你认为方案应该满足哪些重要标准？'),
      field('idea_1','方案1：核心想法是什么？它怎样回应使用者的需要？'),
      field('idea_2','方案2：它与方案1有什么明显不同？'),
      field('comparison','按照设计标准比较两个方案：各自的优点、问题和证据是什么？'),
      field('selected_idea','目前更倾向哪个方案？为什么？',{required:false}),
    ],
    artifacts:[artifact('idea_sketch','上传至少包含两个方案的草图 / 结构示意')],
    prompt_context:'正式主项目启动：辅助绘画装置的使用者理解、问题定义、criteria/constraints与多方案构思阶段。本节从新的主项目情境开始，不承接W2午餐体验试用任务。AI可围绕学生提供的需求、证据、标准和方案进行帮助，但不要替学生完成最终可提交方案。',
  },
  {
    id:'W4', order:4, date:'10/12',
    title:'辅助绘画装置：制作V1', subtitle:'把方案做成可以测试的第一版原型',
    student_label:'第4课 · 正式主项目', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false, carry_from:'W3',
    brief:['根据方案制作第一版可测试原型（V1）。','重点不是漂亮，而是让关键功能真的能测试。'],
    requirements:['优先完成与核心需要直接相关的功能。','记录当前最难解决的制作问题。','保存V1照片。'],
    fields:[field('build_challenge','制作过程中最难解决的问题是什么？'),field('v1_function','V1目前能实现什么核心功能？')],
    artifacts:[artifact('v1_photo','上传V1原型照片')],
    prompt_context:'V1制作阶段。支持应围绕学生真实制作问题、材料、结构和可行性。',
  },
  {
    id:'W5', order:5, date:'10/19',
    title:'辅助绘画装置：测试V1', subtitle:'用证据找出真正需要改进的地方',
    student_label:'第5课 · 正式主项目', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false, carry_from:'W4',
    brief:['测试V1，记录发生了什么，而不是只写“好/不好”。','依据原有设计条件和使用者需要判断问题。'],
    requirements:['写清测试目标与实际结果。','至少记录1—2个关键问题。','保存测试证据。'],
    fields:[field('test_goal','这次测试主要想检查什么？'),field('test_result','测试中实际发生了什么？'),field('key_problems','下一步最需要解决的1—2个问题')],
    artifacts:[artifact('test_evidence','上传测试记录 / 关键现象照片')],
    prompt_context:'V1测试阶段。AI应帮助学生基于实际测试证据判断问题，不虚构测试结果。',
  },
  {
    id:'W6', order:6, date:'10/26',
    title:'辅助绘画装置：制定修改计划', subtitle:'从测试证据出发决定V2怎么改',
    student_label:'第6课 · 正式主项目', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false, carry_from:'W5',
    brief:['重新查看V1测试证据。','决定保留什么、修改什么，以及修改依据。'],
    requirements:['每个重要修改尽量对应测试证据或使用者需要。','形成清楚的V2修改计划。'],
    fields:[field('keep','哪些部分准备保留？为什么？'),field('revise','哪些部分准备修改？依据是什么？'),field('revision_plan','V2修改计划')],
    artifacts:[artifact('revision_plan_image','上传修改计划草图 / 标注图',{required:false})],
    prompt_context:'根据V1测试证据制定V2修改计划。支持应促进“证据—判断—修改决定”的联系。',
  },
  {
    id:'W7', order:7, date:'11/16',
    title:'辅助绘画装置：制作V2', subtitle:'按修改计划实施关键改进',
    student_label:'第7课 · 正式主项目', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false, carry_from:'W6',
    brief:['根据修改计划完成第二版原型（V2）。','制作过程中可以调整计划，但要说明为什么。'],
    requirements:['至少完成一个基于测试证据的实质修改。','记录与V1相比最重要的变化。','保存V2照片。'],
    fields:[field('major_change','V2相较V1最重要的变化是什么？'),field('change_reason','为什么这样改？')],
    artifacts:[artifact('v2_photo','上传V2原型照片')],
    prompt_context:'V2制作阶段。AI应围绕学生已有修改计划和实际制作困难回应。',
  },
  {
    id:'W8', order:8, date:'11/23',
    title:'辅助绘画装置：V2测试与正式完成', subtitle:'正式项目结束｜提交作品后完成后测',
    student_label:'第8课 · 正式主项目', research_role:'intervention', phase:'intervention', ai_mode:'condition', candidate:false, carry_from:'W7', questionnaire_slot:'post', questionnaire_after_submit:true,
    brief:['重新测试V2，并与V1比较。','根据证据说明修改解决了什么、还留下什么问题。','提交正式主项目作品后完成同一份学业求助意图后测。'],
    requirements:['记录V2测试结果。','说明V1→V2发生了什么变化。','上传最终原型和必要测试证据。'],
    fields:[field('v2_test_result','V2测试结果是什么？'),field('comparison','与V1相比，发生了什么变化？'),field('remaining_problem','如果还能继续改，你最想解决什么？',{required:false})],
    artifacts:[artifact('final_prototype','上传最终原型 / V2测试照片')],
    prompt_context:'正式主项目完成阶段。帮助应基于学生提供的实际测试证据，不能替学生虚构改善结果。',
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
    if (isTest) return 'free';
    return 'unassigned';
  }
  return 'free';
}

export function hiddenAiContext(session) {
  return [
    '【课堂任务上下文：只用于帮助AI理解当前任务，不要把这段文字原样复述给学生，也不要把它变成固定提问脚本。】',
    `课次：${session.id} ${session.title}`,
    `研究阶段：${session.phase || session.research_role || ''}`,
    `任务说明：${session.brief.join(' ')}`,
    `任务要求：${session.requirements.join(' ')}`,
    session.prompt_context || '',
    '学生可以自主决定是否、何时使用AI。不要主动要求学生采用固定求助模板。',
  ].filter(Boolean).join('\n');
}
