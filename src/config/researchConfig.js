export const SCHEMA_VERSION = 11;
export const PROMPT_VERSION_FREE = 'free-ai-v2';
export const PROMPT_VERSION_SUPPORTED = 'help-seeking-support-v1';

export const CONDITIONS = ['unassigned', 'A', 'B'];

export const DEFAULT_SETTINGS = {
  active_session_id: 'W1',
  session_open: true,
  questionnaire_enabled: false,
};

export const QUESTIONNAIRE_ITEMS = [];

const field = (key, label, options = {}) => ({
  key,
  label,
  type: options.type || 'textarea',
  required: options.required !== false,
  placeholder: options.placeholder || '',
  helper: options.helper || '',
});
const artifact = (key, label, options = {}) => ({
  key,
  label,
  required: options.required !== false,
  helper: options.helper || '请拍清楚后上传 JPG、PNG 或 WEBP 图片。',
});

export const SESSIONS = [
  {
    id: 'W1', order: 1, date: '9/14',
    title: '椅子快速设计挑战', subtitle: '从真实需要出发，完成一次快速设计',
    student_label: '第1课 · 设计热身', research_role: 'pilot', ai_mode: 'free', candidate: false,
    brief: [
      '小林喜欢坐着画画。',
      '画画时，他经常要同时使用画本、画笔和水杯。',
      '普通椅子只能坐，很多东西没地方放，坐久了也不舒服。',
      '请为小林重新设计一把更适合画画的椅子。',
    ],
    requirements: [
      '椅子首先要能正常坐。',
      '至少解决小林的一个真实问题。',
      '功能要能说清楚大概怎么实现。',
      '可以大胆想，但要有基本现实可行性。',
      '草图不比画功，只要别人能看懂你的想法。',
    ],
    fields: [
      field('need_statement', '你认为小林最需要解决的问题是什么？', { placeholder: '用你自己的话写下来……' }),
      field('design_note', '用一句话说明你的设计思路', { placeholder: '我的设计主要想……' }),
    ],
    artifacts: [artifact('design_sketch', '上传你的设计草图')],
    prompt_context: '当前任务是为喜欢坐着画画的小林重新设计一把椅子。学生可自行决定是否、何时使用AI。不要主动教授求助方法。',
  },
  {
    id: 'W2', order: 2, date: '9/21',
    title: '正式基线设计任务', subtitle: '完成新的短设计任务，AI从任务开始即可使用',
    student_label: '第2课 · 设计挑战', research_role: 'baseline', ai_mode: 'free', candidate: true,
    brief: [
      '雨天上学时，背着书包的学生常常需要一边撑伞、一边保护书包和学习用品。',
      '普通雨具并不总能兼顾走路、拿东西和保护书包。',
      '请为雨天背书包上学的学生设计一种更方便的随身解决方案。',
    ],
    requirements: [
      '先明确你最想解决的一个真实困难。',
      '方案需要能解释如何使用。',
      '可以是物品、结构或使用方式，不要求画得精美。',
      'AI从任务开始即可使用；是否使用、什么时候使用由你自己决定。',
    ],
    fields: [
      field('problem_statement', '你最想解决的困难是什么？', { placeholder: '我最想解决……' }),
      field('solution_summary', '用一句话概括你的方案', { placeholder: '我的方案是……' }),
    ],
    artifacts: [artifact('final_design', '上传最终设计方案')],
    questionnaire_slot: 'pre',
    prompt_context: '当前任务是为雨天背书包上学的学生设计更方便的随身解决方案。这是正式基线任务，所有学生均使用普通自由AI，不提供求助过程教学。',
  },
  {
    id: 'W3', order: 3, date: '9/28',
    title: '辅助绘画装置：理解使用者', subtitle: '主项目启动｜了解需要并形成设计任务书',
    student_label: '第3课 · 主项目', research_role: 'pre_intervention', ai_mode: 'free', candidate: false,
    brief: [
      '主项目：为手部精细动作存在困难的使用者设计一种辅助绘画装置。',
      '装置需要帮助使用者更稳定、更方便地握持或控制绘画工具。',
      '本节先理解使用者和使用情境，不急着把最终方案定死。',
    ],
    requirements: [
      '明确使用者是谁、在什么情境下使用。',
      '记录至少两个真实需要或困难。',
      '形成清楚的设计任务书，作为后续构思与制作依据。',
      '长假前完成并保存这一阶段，不留下半完成状态。',
    ],
    fields: [
      field('user_profile', '使用者是谁？使用情境是什么？', { placeholder: '例如：在……情境下，需要……' }),
      field('needs', '记录至少两个需要或困难', { placeholder: '1. ……\n2. ……' }),
      field('design_brief', '本项目的设计任务书', { placeholder: '我要为……设计……，帮助他/她……' }),
    ],
    artifacts: [artifact('need_card', '上传使用者需要卡 / 课堂记录', { required: false })],
    prompt_context: '当前是辅助绘画装置主项目的使用者理解与问题明确阶段。AI可以提供普通学习帮助，但不要替学生虚构使用者证据。',
  },
  {
    id: 'W4', order: 4, date: '10/12',
    title: '辅助绘画装置：构思方案', subtitle: '产生多个方案，比较后选择一个继续发展',
    student_label: '第4课 · 主项目', research_role: 'intervention', ai_mode: 'condition', candidate: false, carry_from: 'W3',
    brief: [
      '根据已经确定的使用者需要，产生多个不同的设计方案。',
      '不要只画一个想法就结束；先扩大可能性，再比较选择。',
    ],
    requirements: [
      '至少形成3个有明显差异的方案。',
      '每个方案都要能对应至少一个使用者需要。',
      '比较后选择一个方案继续制作，并说明理由。',
    ],
    fields: [
      field('ideas', '简要记录你的多个方案', { placeholder: '方案1：……\n方案2：……\n方案3：……' }),
      field('selected_idea', '你最终选择哪个方案？为什么？', { placeholder: '我选择……，因为……' }),
    ],
    artifacts: [artifact('idea_sheet', '上传构思草图 / 方案比较页')],
    prompt_context: '当前是辅助绘画装置的构思阶段。所有建议都应围绕已确定的使用者需要，避免直接替学生完成完整设计。',
  },
  {
    id: 'W5', order: 5, date: '10/19',
    title: '辅助绘画装置：制作V1', subtitle: '把选择的方案做成可以测试的第一版原型',
    student_label: '第5课 · 主项目', research_role: 'intervention', ai_mode: 'condition', candidate: false, carry_from: 'W4',
    brief: [
      '把已选择的方案做成第一版可测试原型（V1）。',
      '重点不是“做得漂亮”，而是让关键功能真的能被测试。',
    ],
    requirements: [
      '优先完成与核心需要直接相关的功能。',
      '遇到材料或结构困难时，可以自行决定是否使用AI。',
      '记录当前最难解决的制作问题。',
    ],
    fields: [
      field('build_challenge', '制作过程中最难解决的问题是什么？', { placeholder: '我目前最困难的是……' }),
      field('v1_function', 'V1目前能实现什么核心功能？', { placeholder: '目前它可以……' }),
    ],
    artifacts: [artifact('v1_photo', '上传V1原型照片')],
    prompt_context: '当前是辅助绘画装置V1制作阶段。帮助应围绕学生正在遇到的真实制作问题，不替学生声称某个结构一定可行。',
  },
  {
    id: 'W6', order: 6, date: '10/26',
    title: '辅助绘画装置：测试V1', subtitle: '用证据找出V1真正需要改进的地方',
    student_label: '第6课 · 主项目', research_role: 'intervention', ai_mode: 'condition', candidate: false, carry_from: 'W5',
    brief: [
      '测试第一版原型（V1），重点记录“发生了什么”，而不是只写“好/不好”。',
      '本节结束后会有较长间隔，必须把测试证据和问题完整保存。',
    ],
    requirements: [
      '写清测试目标和实际结果。',
      '至少记录1—2个最关键的问题。',
      '保存V1照片、测试记录和后续要继续解决的问题。',
    ],
    fields: [
      field('test_goal', '这次测试主要想检查什么？', { placeholder: '我想检查……' }),
      field('test_result', '测试中实际发生了什么？', { placeholder: '测试时发现……' }),
      field('key_problems', '下一步最需要解决的1—2个问题', { placeholder: '1. ……\n2. ……' }),
    ],
    artifacts: [artifact('test_evidence', '上传测试记录 / 关键现象照片')],
    prompt_context: '当前是辅助绘画装置V1测试阶段。AI应帮助理解和使用测试证据，不应无依据替学生判断测试结果。',
  },
  {
    id: 'W7', order: 7, date: '11/16',
    title: '辅助绘画装置：制定修改计划', subtitle: '从测试证据出发，决定V2要改什么',
    student_label: '第7课 · 主项目', research_role: 'intervention', ai_mode: 'condition', candidate: false, carry_from: 'W6',
    brief: [
      '重新查看上次保存的测试证据和关键问题。',
      '不是“重新设计一个新的”，而是决定哪些地方值得改、为什么改。',
    ],
    requirements: [
      '每个修改点都尽量对应一条测试证据或使用者需要。',
      '说明准备保留什么、修改什么。',
      '形成清楚的V2修改计划。',
    ],
    fields: [
      field('keep', '哪些部分准备保留？为什么？', { placeholder: '我准备保留……，因为……' }),
      field('revise', '哪些部分准备修改？依据是什么？', { placeholder: '我准备修改……，因为测试发现……' }),
      field('revision_plan', 'V2修改计划', { placeholder: '第一步……\n第二步……' }),
    ],
    artifacts: [artifact('revision_plan_image', '上传修改计划草图 / 标注图', { required: false })],
    prompt_context: '当前是依据V1测试证据制定V2修改计划。支持应促进学生把测试证据与修改决定联系起来。',
  },
  {
    id: 'W8', order: 8, date: '11/23',
    title: '辅助绘画装置：制作V2', subtitle: '按修改计划实施关键改进',
    student_label: '第8课 · 主项目', research_role: 'intervention', ai_mode: 'condition', candidate: false, carry_from: 'W7',
    brief: [
      '根据修改计划完成第二版原型（V2）。',
      '制作过程中可以调整计划，但要能说明为什么。',
    ],
    requirements: [
      '至少完成一个基于测试证据的实质修改。',
      '记录与V1相比最重要的变化。',
      '保存V2照片。',
    ],
    fields: [
      field('major_change', 'V2相较V1最重要的变化是什么？', { placeholder: '最大的变化是……' }),
      field('change_reason', '为什么这样改？', { placeholder: '因为……' }),
    ],
    artifacts: [artifact('v2_photo', '上传V2原型照片')],
    prompt_context: '当前是辅助绘画装置V2制作阶段。AI应围绕学生已有修改计划和实际制作困难回应。',
  },
  {
    id: 'W9', order: 9, date: '11/30',
    title: '辅助绘画装置：V2测试与完成', subtitle: '再次测试，比较变化并完成主项目',
    student_label: '第9课 · 主项目', research_role: 'intervention', ai_mode: 'condition', candidate: false, carry_from: 'W8',
    brief: [
      '重新测试V2，并与V1的测试结果进行比较。',
      '根据证据说明这次修改解决了什么、还留下什么问题。',
    ],
    requirements: [
      '记录V2测试结果。',
      '明确V1→V2后哪些方面变好了、没变化或出现新问题。',
      '上传最终原型和必要测试证据。',
    ],
    fields: [
      field('v2_test_result', 'V2测试结果是什么？', { placeholder: 'V2测试时……' }),
      field('comparison', '与V1相比，发生了什么变化？', { placeholder: '相比V1……' }),
      field('remaining_problem', '如果还能继续改，你最想解决什么？', { required: false, placeholder: '如果继续，我会……' }),
    ],
    artifacts: [artifact('final_prototype', '上传最终原型 / V2测试照片')],
    prompt_context: '当前是主项目V2测试与完成阶段。帮助应基于学生提供的实际测试证据，不能替学生虚构改善结果。',
  },
  {
    id: 'W10', order: 10, date: '12/7',
    title: '迁移任务一', subtitle: '新的设计情境｜所有学生使用相同自由AI',
    student_label: '第10课 · 新挑战', research_role: 'transfer', ai_mode: 'free', candidate: true,
    brief: [
      '有些人手部力量较弱，拿起、握住或稳定使用普通水杯会比较困难。',
      '请设计一种帮助这类使用者更方便使用水杯的辅助方案。',
    ],
    requirements: [
      '先明确你认为最关键的使用困难。',
      '方案需要能解释如何使用。',
      '可以使用AI，也可以不用；没有任何额外提示。',
    ],
    fields: [
      field('problem_statement', '你最想解决的使用困难是什么？'),
      field('solution_summary', '用一句话概括你的解决方案'),
    ],
    artifacts: [artifact('transfer_design_1', '上传最终设计方案')],
    prompt_context: '这是撤除实验性支持后的迁移任务。所有学生均使用完全相同的普通自由AI。不要提供固定求助流程。',
  },
  {
    id: 'W11', order: 11, date: '12/14',
    title: '迁移任务二', subtitle: '表面情境不同的新任务｜继续自由AI',
    student_label: '第11课 · 新挑战', research_role: 'transfer', ai_mode: 'free', candidate: true,
    brief: [
      '课间或活动场地比较嘈杂时，有些学生容易错过老师发布的重要集合或时间提醒。',
      '请设计一种更可靠的校园提醒解决方案。',
    ],
    requirements: [
      '考虑真实校园使用情境。',
      '说明信息怎样被接收、提醒或确认。',
      '可以使用AI，也可以不用；没有任何额外提示。',
    ],
    fields: [
      field('problem_statement', '你认为最关键的问题是什么？'),
      field('solution_summary', '用一句话概括你的方案'),
    ],
    artifacts: [artifact('transfer_design_2', '上传最终设计方案')],
    prompt_context: '这是第二个撤除支持后的迁移任务。所有学生使用普通自由AI，不提供实验性求助提示。',
  },
  {
    id: 'W12', order: 12, date: '12/21',
    title: '课程回顾与后测', subtitle: '整理作品、完成反思；问卷后测将在定稿后接入',
    student_label: '第12课 · 收尾', research_role: 'posttest', ai_mode: 'none', candidate: false,
    brief: [
      '回顾本学期的设计过程，整理自己的作品和记录。',
      '完成课程反思；后测问卷将在研究工具定稿后由教师开启。',
    ],
    requirements: [
      '回顾一次你真正遇到困难并继续推进任务的经历。',
      '说明你后来是怎样继续完成任务的。',
      '不需要评价自己“好不好”，按真实经历填写即可。',
    ],
    fields: [
      field('reflection_event', '回顾一次你印象最深的困难', { placeholder: '当时我正在……，遇到的问题是……' }),
      field('reflection_action', '后来你是怎样继续推进的？', { placeholder: '后来我……' }),
    ],
    artifacts: [artifact('portfolio_cover', '上传本学期代表性作品 / 作品集封面', { required: false })],
    questionnaire_slot: 'post',
    prompt_context: '',
  },
];

export function getSessionConfig(id) {
  return SESSIONS.find(s => s.id === id) || null;
}

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
    `任务说明：${session.brief.join(' ')}`,
    `任务要求：${session.requirements.join(' ')}`,
    session.prompt_context || '',
    '学生可以自主决定是否、何时使用AI。不要主动要求学生采用固定求助模板。',
  ].filter(Boolean).join('\n');
}
