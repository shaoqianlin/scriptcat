require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');

const app = express();

app.use(cors());
app.use(express.json({ limit: '500kb' }));
app.use((req, res, next) => { req.setTimeout(180000); next(); });
app.use(express.static(path.join(__dirname)));

// ========== 数据库（用户 + 历史） ==========
const db = new DatabaseSync(path.join(__dirname, 'data.db'));

// users 表沿用旧版结构（nickname 作为登录账号），这里只补充会话表和历史表
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    preview TEXT NOT NULL,
    date TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id, created_at);
`);

const MAX_HISTORY = 20;

function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }
function verifyPassword(pw, hash) { return bcrypt.compareSync(pw, hash); }
function newToken() { return crypto.randomBytes(32).toString('hex'); }

// 鉴权中间件：解析 Authorization: Bearer <token>
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: '未登录' });
  const row = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token);
  if (!row) return res.status(401).json({ error: '登录已失效，请重新登录' });
  req.userId = row.user_id;
  req.token = token;
  next();
}

// ========== DNA Analysis Prompt ==========
const DNA_ANALYSIS_PROMPT = `你是一个顶尖的短视频爆款分析师。你帮创作者分析爆款视频，提炼出可以复用的"爆款DNA"。

⚠️ 内容安全限制：禁止分析涉及政治、经济政策、色情、暴力、违法、血腥、恐怖主义等敏感话题的脚本。如果用户提交上述内容，直接回复"⚠️ 请提供健康积极的创作内容，涉及敏感话题的内容无法分析。"，不进行任何分析。

用户给你一条已经爆火的视频脚本，你需要深度分析它为什么能火。

分析框架：

1.【开头钩子分析 — 前3秒为什么能让人停下来】
- 钩子属于什么类型？（从以下6种中选最匹配的）：
  · curiosity_gap（好奇缺口：说一半留一半，让人想知道答案）
  · shocking_stat（震惊数据：用具体数字制造反差）
  · bold_claim（大胆断言：一句话颠覆认知）
  · question（提问切入：直接问目标用户的痛点）
  · visual_hook（视觉钩子：画面本身抓人，不需要语言解释）
  · pattern_interrupt（模式打断：反常行为/场景/声音打破刷视频的惯性）
- 前3秒具体做了什么？为什么这个钩子类型选对了？
- 如果hook不够强，改写建议是什么？

2.【脚本节拍地图 — 按叙事逻辑分段】
将脚本按以下结构拆解（不是每段都要有，选最匹配的4-6个节拍）：
  Hook → Context/Problem → Tension/Conflict → Solution/Reveal → Proof/Example → CTA/Climax
每段标注：节拍名称（2-5字）+ 时间占比 + 这段对观众心理的作用

3.【情绪曲线】
- 核心驱动情绪是什么？
- 从开头到结尾情绪曲线怎么走的？
- 为什么这个情绪设计能驱动完播和转发？

4.【爆款公式提炼】
- 提炼出成功公式，命名（如：痛点+反常识+解决方案）
- 公式要素有哪些？为什么能反复使用？

5.【风格标签】
判断这条视频的：
- 呈现方式（选1个）：talking_head（口播）/ voiceover（配音）/ text_on_screen（文字卡点）/ skit（剧情）/ montage（混剪）/ interview（采访）
- 内容类型（选1个）：educational（知识干货）/ entertainment（娱乐）/ storytelling（故事）/ review（测评）/ tutorial（教程）/ hot_take（观点评论）
- 情绪基调（选1-2个）：紧迫 / 好奇 / 幽默 / 震惊 / 共鸣 / 权威

6.【逐段拆解】
- 把脚本拆成4-6个段落（对应节拍地图）
- 每段：节拍名称 + 触发什么心理 + 原文对应文字 + 段间因果连接

7.【可借鉴的改写方向】
给出3个具体的改写角度，每个包含：
- 改写角度概述（15字内）
- 改写后的hook文案示例（20-50字）
- 最适合的平台（抖音 / 小红书 / 视频号）

8.【标题+介绍文案+标签分析】
如果用户提供了标题、视频介绍文案和标签，你需要分析：
- 标题分析：能不能吸引点击？用了什么标题技巧（如：数字法/提问法/反常识法/利益承诺法）？如果有问题，给出优化方向。
- 介绍文案分析：有没有在开头留住人？结构是否清晰？有没有引导互动？给出优化方向。
- 标签分析：现有标签覆盖了哪些维度（蹭热度/圈人群/SEO）？缺少什么标签？标签之间的搭配逻辑是否合理？

输出格式（严格JSON）：
{
  "level": "deep",
  "whyViral": "一句话大白话说清这条视频为什么能爆（30-50字）",
  "dna": {
    "hook": {
      "type": "curiosity_gap / shocking_stat / bold_claim / question / visual_hook / pattern_interrupt",
      "analysis": "前3秒做了什么，为什么有效（50-80字）",
      "trigger": "触发了观众的什么心理",
      "rewriteTip": "如果hook不够强，怎么改写（30-50字）"
    },
    "beatMap": {
      "flow": ["Hook", "Problem", "Solution", "Proof", "CTA"],
      "analysis": "这个节拍设计的精妙之处（50-80字）"
    },
    "emotion": {
      "primary": ["核心情绪1", "核心情绪2"],
      "curve": "从XX情绪→XX情绪→XX情绪，描述情绪变化曲线（30-50字）"
    },
    "formula": {
      "name": "公式名称（如：痛点+反常识+解决方案）",
      "elements": ["要素1", "要素2", "要素3", "要素4"],
      "whyWorks": "为什么这个公式能反复使用（30-50字）"
    },
    "styleTags": {
      "presentation": "talking_head / voiceover / text_on_screen / skit / montage / interview",
      "contentType": "educational / entertainment / storytelling / review / tutorial / hot_take",
      "emotionTone": "紧迫 / 好奇 / 幽默 / 震惊 / 共鸣 / 权威"
    }
  },
  "skeleton": [
    {
      "role": "节拍名称（2-5字）",
      "psychology": "这段触发观众什么心理",
      "original": "原文对应文字",
      "connect": "这段结尾如何引出下一段？写具体的因果承接"
    }
  ],
  "techniques": ["每条技巧一句话说清：什么技巧+怎么用的+为什么有效"],
  "rewriteDirections": [
    {
      "angle": "改写角度概述（15字内）",
      "hookExample": "改写后的hook文案示例（20-50字）",
      "suitablePlatform": "抖音 / 小红书 / 视频号"
    }
  ],
  "titleDescAnalysis": {
    "title": {
      "technique": "标题使用的技巧（如：数字法/提问法/反常识法/利益承诺法/悬念法）",
      "score": 7,
      "strength": "标题做得好在哪里（20-30字）",
      "suggestion": "优化方向（20-30字）"
    },
    "description": {
      "hook": "介绍文案有没有开头钩子？评价（20-30字）",
      "score": 7,
      "strength": "文案做得好在哪里（20-30字）",
      "suggestion": "优化方向（20-30字）"
    },
    "tags": {
      "existing": ["标签1", "标签2"],
      "cover": "标签覆盖了哪些维度（20-30字）",
      "missing": ["缺失的标签"],
      "suggestion": "标签策略优化（20-30字）"
    }
  }
}

要求：
- 分析要有深度，不要泛泛而谈
- 用大白话，让不懂短视频的创作者也能看懂
- 每个分析要点都要落到"为什么有效"上
- skeleton要把脚本完整覆盖，每段的original要保留原文
- hook.type必须从给定的6种中选择
- styleTags必须从给定选项中选，不要自创
- beatMap.flow用标准节拍名称（Hook/Problem/Tension/Solution/Proof/CTA等）
- 直接输出JSON，不要任何解释`;

// ========== Description Analysis Prompt ==========
const DESCRIPTION_ANALYSIS_PROMPT = `你是一个顶尖的短视频爆款分析师。

⚠️ 内容安全限制：禁止分析涉及政治、经济政策、色情、暴力、违法、血腥、恐怖主义等敏感话题。如果用户提交上述内容，直接回复"⚠️ 请提供健康积极的创作内容"。

用户给你一条爆款视频的【描述文案】——只有标题、标签和简介，没有完整脚本。

你的任务：基于这些有限信息，做出有价值的初步判断，但**不要假装你看到了完整脚本**。

分析框架：

1.【选题判断】
- 这条视频选了什么话题？这个选题为什么天然自带流量？
- 目标用户是谁？他们为什么会对这个话题感兴趣？
- 这个选题的竞争度如何？是大众赛道还是细分蓝海？

2.【切入角度】
- 从描述看，这条视频用的是什么切入角度？
- 这个角度有什么巧妙的点？
- 如果是你，还能从哪些角度切入同一个话题？

3.【风格标签推测】
基于描述文案，推测这条视频的：
- 内容类型（选1个）：educational（知识干货）/ entertainment（娱乐）/ storytelling（故事）/ review（测评）/ tutorial（教程）/ hot_take（观点评论）/ product（种草带货）/ vlog（日常记录）
- 情绪基调（选1-2个）：紧迫 / 好奇 / 幽默 / 震惊 / 共鸣 / 权威
- 呈现方式猜测（选1个）：talking_head（口播）/ voiceover（配音）/ text_on_screen（文字卡点）/ skit（剧情）/ montage（混剪）/ broll（产品展示）
标注这是"推测"，不是确定结论。

4.【标签策略】
- 用了哪些标签？每个标签的作用是什么？（蹭热度/圈人群/做SEO）
- 标签组合的逻辑是什么？

5.【对标与改写建议】
- 这个选题适合哪个内容类型？
- 建议用什么爆款公式来切入这个选题？
- 给出2个具体的改写角度，每条包含hook示例和适合平台
- 给创作者3条可操作的启发

6.【诚实说明】
- 明确指出：以上分析仅基于描述文案，无法判断脚本的具体结构、节奏和钩子设计
- 建议用户找到完整脚本后进行深度拆解

输出格式（严格JSON）：
{
  "level": "basic",
  "whyViral": "一句话判断：这个选题为什么会火（20-40字）",
  "topic": {
    "subject": "这条视频聊的具体话题",
    "audience": "目标用户画像",
    "competition": "高竞争/中等/蓝海",
    "naturalTraffic": "这个选题为什么天然自带流量（30-50字）"
  },
  "angle": {
    "current": "当前切入角度",
    "cleverPoint": "这个角度巧在哪里（20-30字）",
    "alternatives": ["另一种切入角度1", "另一种切入角度2"]
  },
  "styleTags": {
    "contentType": "educational / entertainment / storytelling / review / tutorial / hot_take / product / vlog",
    "emotionTone": "紧迫 / 好奇 / 幽默 / 震惊 / 共鸣 / 权威",
    "estimatedPresentation": "talking_head / voiceover / text_on_screen / skit / montage / broll（此为推测）"
  },
  "tags": [
    {"tag": "标签名", "purpose": "这个标签的作用（蹭热度/圈人群/SEO）"}
  ],
  "advice": {
    "contentType": "建议的内容类型",
    "suggestedFormula": "建议的爆款公式",
    "tips": ["可操作的启发1", "启发2", "启发3"]
  },
  "rewriteDirections": [
    {
      "angle": "改写角度概述（15字内）",
      "hookExample": "改写后的hook文案示例（20-50字）",
      "suitablePlatform": "抖音 / 小红书 / 视频号"
    }
  ],
  "honesty": "⚠️ 以上分析仅基于描述文案，未看到完整脚本结构。想真正拆解这条视频的节奏和钩子？找到完整脚本后粘贴进来，我帮你深度拆解。"
}

要求：
- 基于有限信息做出有价值的判断，不要编造你没看到的内容
- 每个判断都要落到"为什么"上
- styleTags必须从给定选项中选，不要自创
- rewriteDirections给2条（不是3条，因为没有完整脚本）
- 大白话，能让不懂短视频的人也看懂
- 直接输出JSON，不要任何解释`;


// ========== API: 爆款DNA分析 ==========
app.post('/api/analyze', async (req, res) => {
  const { script, title, desc, tags } = req.body;

  if (!script || script.trim().length < 10) {
    return res.status(400).json({ error: '内容太短了～至少10个字' });
  }

  // Build user message with optional title/desc/tags
  let userContent = script.trim();
  const hasMeta = (title && title.trim()) || (desc && desc.trim()) || (tags && tags.trim());
  if (hasMeta) {
    const parts = [];
    if (title && title.trim()) parts.push('【视频标题】\n' + title.trim());
    if (desc && desc.trim()) parts.push('【视频介绍文案】\n' + desc.trim());
    if (tags && tags.trim()) parts.push('【标签】\n' + tags.trim());
    parts.push('【完整脚本】\n' + userContent);
    userContent = parts.join('\n\n');
  }

  // 根据输入长度自动选择分析深度
  const charCount = script.trim().length;
  const isDeep = charCount >= 200;
  const systemPrompt = isDeep ? DNA_ANALYSIS_PROMPT : DESCRIPTION_ANALYSIS_PROMPT;
  const level = isDeep ? 'deep' : 'basic';
  console.log(`分析请求: ${charCount}字 → ${level}`);

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const apiUrl = process.env.API_URL || 'https://api.deepseek.com/v1/chat/completions';
  const model = process.env.MODEL || 'deepseek-chat';

  if (!apiKey) {
    console.error('DEEPSEEK_API_KEY not set');
    return res.status(500).json({ error: '服务还没配置好，请联系开发者设置API Key' });
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        temperature: 0.3,
        max_tokens: 16000
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('LLM API error:', response.status, err);
      return res.status(502).json({ error: 'AI服务暂时不可用，请稍后重试' });
    }

    const responseText = await response.text();
    console.error('[Analyze] response length:', responseText.length);
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('[Analyze] response.json() failed:', e.message);
      return res.status(502).json({ error: 'AI返回异常，请稍后重试' });
    }
    const content = data.choices?.[0]?.message?.content || '';

    console.error('[Analyze] content length:', content.length, 'finish_reason:', data.choices?.[0]?.finish_reason);

    // Parse JSON (may be wrapped in markdown code block)
    let jsonStr = content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    // Try to parse, with repair for truncated JSON
    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('[Analyze] parse error:', parseErr.message);
      console.error('[Analyze] last 100 chars:', jsonStr.slice(-100));
      // Attempt to repair: close unclosed braces/brackets
      let repaired = jsonStr;
      let braces = 0, brackets = 0, inString = false, escaped = false;
      for (const ch of repaired) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') braces++;
        if (ch === '}') braces--;
        if (ch === '[') brackets++;
        if (ch === ']') brackets--;
      }
      console.error('[Analyze] repair: braces=' + braces + ' brackets=' + brackets);
      while (brackets > 0) { repaired += ']'; brackets--; }
      while (braces > 0) { repaired += '}'; braces--; }
      repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

      try {
        result = JSON.parse(repaired);
        console.error('[Analyze] JSON repair OK');
      } catch (repairErr) {
        console.error('[Analyze] repair failed:', repairErr.message);
        console.error('[Analyze] raw first 500:', jsonStr.substring(0, 500));
        // Last resort: return raw text as analysis
        result = {
          whyViral: '（AI返回了非标准格式，以下是原始分析内容）\n\n' + content.substring(0, 2000),
          dna: { hook: {}, beatMap: {}, emotion: {}, formula: {}, styleTags: {} },
          skeleton: [],
          techniques: [],
          rewriteDirections: []
        };
      }
    }

    // Safety: ensure result is always an object
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      console.error('[Analyze] result is not an object, type:', typeof result);
      result = {
        whyViral: typeof result === 'string' ? result : content.substring(0, 2000),
        dna: { hook: {}, beatMap: {}, emotion: {}, formula: {}, styleTags: {} },
        skeleton: [],
        techniques: [],
        rewriteDirections: []
      };
    }

    result.level = level;

    // Save original script in result
    result.original = script;

    res.json(result);
  } catch (err) {
    console.error('Analyze error:', err.message);
    if (err instanceof SyntaxError) {
      res.status(500).json({ error: 'AI输出格式异常，请缩短脚本后重试' });
    } else {
      res.status(500).json({ error: '拆解失败：' + err.message });
    }
  }
});

// ========== API: 归纳总结（跨视频共性分析）==========
app.post('/api/synthesize', async (req, res) => {
  const { analyses, topic } = req.body;

  if (!analyses || !Array.isArray(analyses) || analyses.length < 2) {
    return res.status(400).json({ error: '至少需要2条分析结果才能归纳总结' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const apiUrl = process.env.API_URL || 'https://api.deepseek.com/v1/chat/completions';
  const model = process.env.MODEL || 'deepseek-chat';

  if (!apiKey) {
    return res.status(500).json({ error: '服务还没配置好' });
  }

  try {
    // Build a compact summary of each analysis for the prompt
    const analysesSummary = analyses.map((a, i) => {
      const d = a.dna || {};
      const hookType = d.hook?.type || '未知';
      const formulaName = d.formula?.name || '';
      const formulaElements = (d.formula?.elements || []).join(' + ');
      const beatFlow = (d.beatMap?.flow || d.structure?.flow || []).join(' → ');
      const emotionCurve = d.emotion?.curve || '';
      const primaryEmotions = (d.emotion?.primary || []).join('、');
      const techniques = (a.techniques || []).slice(0, 3).join('；');
      const styleTags = d.styleTags || {};
      const contentType = styleTags.contentType || a.topic?.subject || '未知';
      const presentation = styleTags.presentation || '';
      const emotionTone = styleTags.emotionTone || '';

      return `【视频${i + 1}】${a.whyViral || ''}
内容类型：${contentType}
钩子类型：${hookType} | 爆款公式：${formulaName}（${formulaElements}）
节拍结构：${beatFlow} | 情绪曲线：${emotionCurve}（${primaryEmotions}）
呈现方式：${presentation} | 情绪基调：${emotionTone}
技巧：${techniques || '无'}`;
    }).join('\n\n');

    const topicContext = topic ? `\n这批视频的主题方向：${topic}` : '';

    const synthPrompt = `你是一个顶尖的短视频爆款分析师。用户给了你${analyses.length}条同类型的爆款视频分析结果，你需要找出它们之间的共性规律。

⚠️ 内容安全限制：禁止讨论政治、色情、暴力等敏感话题。

——【分析数据】——${topicContext}
${analysesSummary}

——【任务】——
找出这${analyses.length}条爆款的共性规律，输出纯JSON（不要markdown代码块）：

{
  "summary": "一句话总结这批爆款的共同规律（30-50字）",
  "hookPatterns": {
    "mostCommon": "最常见的钩子类型",
    "distribution": "各类型的分布描述（20-30字）",
    "insight": "为什么这类钩子在这个赛道有效（30-50字）"
  },
  "structurePatterns": {
    "commonFlows": ["共性的结构流程1", "流程2"],
    "insight": "这种结构为什么能反复使用（30-50字）"
  },
  "emotionPatterns": {
    "commonCurves": ["共性的情绪走向"],
    "insight": "这种情绪设计为什么驱动完播（30-50字）"
  },
  "techniquePatterns": {
    "recurring": ["反复出现的技巧1", "技巧2", "技巧3"],
    "insight": "这些技巧的共性逻辑（30-50字）"
  },
  "stylePatterns": {
    "contentTypes": "内容类型分布",
    "presentations": "呈现方式分布",
    "insight": "风格层面的共性（20-30字）"
  },
  "rewriteInsights": "基于以上共性规律，给创作者3条可操作的改写建议（每条20-30字，用序号分隔）"
}

要求：
- 找共性，不是复述每条视频
- 每个insight都要落到"为什么有效"上
- 大白话，创作者看完就能用
- 直接输出JSON`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: synthPrompt },
          { role: 'user', content: `帮我归纳这${analyses.length}条爆款的共性规律${topic ? '，主题：' + topic : ''}` }
        ],
        temperature: 0.3,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Synthesize API error:', response.status, err);
      return res.status(502).json({ error: 'AI服务暂时不可用，请稍后重试' });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    console.error('[Synthesize] content length:', content.length, 'finish_reason:', data.choices?.[0]?.finish_reason);

    let jsonStr = content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    // JSON repair: close unclosed braces/brackets (same as /api/analyze)
    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('[Synthesize] parse error:', parseErr.message);
      console.error('[Synthesize] last 100 chars:', jsonStr.slice(-100));
      let repaired = jsonStr;
      let braces = 0, brackets = 0, inString = false, escaped = false;
      for (const ch of repaired) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') braces++;
        if (ch === '}') braces--;
        if (ch === '[') brackets++;
        if (ch === ']') brackets--;
      }
      console.error('[Synthesize] repair: braces=' + braces + ' brackets=' + brackets);
      while (brackets > 0) { repaired += ']'; brackets--; }
      while (braces > 0) { repaired += '}'; braces--; }
      repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

      try {
        result = JSON.parse(repaired);
        console.error('[Synthesize] JSON repair OK');
      } catch (repairErr) {
        console.error('[Synthesize] repair failed:', repairErr.message);
        return res.status(500).json({ error: 'AI输出格式异常，请重试' });
      }
    }

    res.json(result);

  } catch (err) {
    console.error('Synthesize error:', err.message);
    if (err instanceof SyntaxError) {
      res.status(500).json({ error: 'AI输出格式异常，请重试' });
    } else {
      res.status(500).json({ error: '归纳失败：' + err.message });
    }
  }
});

// ========== 用户注册 / 登录 ==========
app.post('/api/register', (req, res) => {
  const name = (req.body?.username || '').trim();
  const pw = req.body?.password || '';
  if (name.length < 2 || name.length > 20) return res.status(400).json({ error: '用户名需 2-20 个字符' });
  if (pw.length < 6) return res.status(400).json({ error: '密码至少 6 位' });

  const exists = db.prepare('SELECT id FROM users WHERE nickname = ?').get(name);
  if (exists) return res.status(409).json({ error: '用户名已存在，换个试试' });

  const info = db.prepare('INSERT INTO users (nickname, password_hash, created_at) VALUES (?, ?, ?)')
    .run(name, hashPassword(pw), new Date().toISOString());
  const userId = Number(info.lastInsertRowid);
  const token = newToken();
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, Date.now());

  res.json({ token, username: name });
});

app.post('/api/login', (req, res) => {
  const name = (req.body?.username || '').trim();
  const pw = req.body?.password || '';
  const user = db.prepare('SELECT id, nickname, password_hash FROM users WHERE nickname = ?').get(name);
  if (!user || !verifyPassword(pw, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = newToken();
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, user.id, Date.now());
  res.json({ token, username: user.nickname });
});

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, nickname FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(401).json({ error: '用户不存在' });
  res.json({ username: user.nickname });
});

app.post('/api/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
});

// ========== 历史记录（登录用户，云端存储，每人最多20条） ==========
app.get('/api/history', auth, (req, res) => {
  const rows = db.prepare('SELECT id, preview, date, data FROM history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(req.userId, MAX_HISTORY);
  const list = rows.map(r => {
    let data = {};
    try { data = JSON.parse(r.data); } catch {}
    return { id: r.id, preview: r.preview, date: r.date, data };
  });
  res.json(list);
});

app.post('/api/history', auth, (req, res) => {
  const preview = (req.body?.preview || '').trim();
  const date = req.body?.date || '';
  if (!preview) return res.status(400).json({ error: '缺少预览内容' });

  // 去重：同一条（相同 preview）覆盖旧的
  db.prepare('DELETE FROM history WHERE user_id = ? AND preview = ?').run(req.userId, preview);
  db.prepare('INSERT INTO history (user_id, preview, date, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.userId, preview, date, JSON.stringify(req.body?.data || {}), Date.now());

  // 只保留最近20条，删掉更早的
  const all = db.prepare('SELECT id FROM history WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(req.userId);
  if (all.length > MAX_HISTORY) {
    const del = db.prepare('DELETE FROM history WHERE id = ?');
    all.slice(MAX_HISTORY).forEach(r => del.run(r.id));
  }

  res.json({ ok: true });
});

app.delete('/api/history/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '无效的记录' });
  db.prepare('DELETE FROM history WHERE id = ? AND user_id = ?').run(id, req.userId);
  res.json({ ok: true });
});

// ========== 启动 ==========
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🐱 爆款猫 running at http://localhost:${PORT}`);
  console.log('   手机访问：http://' + getLocalIP() + ':' + PORT);
});

function getLocalIP() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}
