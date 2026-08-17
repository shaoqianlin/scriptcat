import { DESCRIPTION_ANALYSIS_PROMPT, DNA_ANALYSIS_PROMPT } from './prompts.js';
import { parseJsonResult } from './json-result.js';

const DEFAULT_API_URL = 'https://api.deepseek.com/v1/chat/completions';

function fallbackAnalysis(content, original, level) {
  return {
    whyViral: `（AI返回了非标准格式，以下是原始分析内容）\n\n${content.substring(0, 2000)}`,
    dna: { hook: {}, beatMap: {}, emotion: {}, formula: {}, styleTags: {} },
    skeleton: [],
    techniques: [],
    rewriteDirections: [],
    level,
    original,
  };
}

function buildAnalyzeContent(script, title, desc, tags) {
  let content = script.trim();
  const hasMeta = (title && title.trim()) || (desc && desc.trim()) || (tags && tags.trim());
  if (!hasMeta) return content;

  const parts = [];
  if (title && title.trim()) parts.push(`【视频标题】\n${title.trim()}`);
  if (desc && desc.trim()) parts.push(`【视频介绍文案】\n${desc.trim()}`);
  if (tags && tags.trim()) parts.push(`【标签】\n${tags.trim()}`);
  parts.push(`【完整脚本】\n${content}`);
  return parts.join('\n\n');
}

function summarizeAnalyses(analyses, topic) {
  const summary = analyses.map((analysis, index) => {
    const dna = analysis.dna || {};
    const styleTags = dna.styleTags || {};
    const formula = dna.formula || {};
    const emotion = dna.emotion || {};
    const beatMap = dna.beatMap || {};
    return `【视频${index + 1}】${analysis.whyViral || ''}
内容类型：${styleTags.contentType || analysis.topic?.subject || '未知'}
钩子类型：${dna.hook?.type || '未知'} | 爆款公式：${formula.name || ''}（${(formula.elements || []).join(' + ')}）
节拍结构：${(beatMap.flow || dna.structure?.flow || []).join(' → ')} | 情绪曲线：${emotion.curve || ''}（${(emotion.primary || []).join('、')}）
呈现方式：${styleTags.presentation || ''} | 情绪基调：${styleTags.emotionTone || ''}
技巧：${(analysis.techniques || []).slice(0, 3).join('；') || '无'}`;
  }).join('\n\n');
  return `${topic ? `\n这批视频的主题方向：${topic}` : ''}\n${summary}`;
}

function buildSynthesisPrompt(analyses, topic) {
  return `你是一个顶尖的短视频爆款分析师。用户给了你${analyses.length}条同类型的爆款视频分析结果，你需要找出它们之间的共性规律。

⚠️ 内容安全限制：禁止讨论政治、色情、暴力等敏感话题。

——【分析数据】——${summarizeAnalyses(analyses, topic)}

——【任务】——
找出这${analyses.length}条爆款的共性规律，输出纯JSON（不要markdown代码块）：
{
  "summary": "一句话总结这批爆款的共同规律（30-50字）",
  "hookPatterns": {"mostCommon": "最常见的钩子类型", "distribution": "各类型的分布描述", "insight": "为什么这类钩子在这个赛道有效"},
  "structurePatterns": {"commonFlows": ["共性的结构流程1", "流程2"], "insight": "这种结构为什么能反复使用"},
  "emotionPatterns": {"commonCurves": ["共性的情绪走向"], "insight": "这种情绪设计为什么驱动完播"},
  "techniquePatterns": {"recurring": ["反复出现的技巧1", "技巧2", "技巧3"], "insight": "这些技巧的共性逻辑"},
  "stylePatterns": {"contentTypes": "内容类型分布", "presentations": "呈现方式分布", "insight": "风格层面的共性"},
  "rewriteInsights": "基于以上共性规律，给创作者3条可操作的改写建议（每条20-30字，用序号分隔）"
}

要求：找共性，不是复述每条视频；每个insight都要落到为什么有效；大白话；直接输出JSON`;
}

async function callDeepSeek({ apiKey, apiUrl, model, systemPrompt, userContent, maxTokens, fetchImpl = fetch, timeoutMs = 120000 }) {
  if (!apiKey) return { status: 500, body: { error: '服务还没配置好，请联系开发者设置API Key' } };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(apiUrl || DEFAULT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'deepseek-chat',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return { status: 502, body: { error: 'AI服务暂时不可用，请稍后重试' } };
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    return { status: 200, content };
  } catch (error) {
    return { status: error.name === 'AbortError' ? 504 : 500, body: { error: error.name === 'AbortError' ? 'AI服务响应超时，请稍后重试' : `请求失败：${error.message}` } };
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzeScript({ script, title = '', desc = '', tags = '', config }) {
  if (!script || script.trim().length < 10) return { status: 400, body: { error: '内容太短了～至少10个字' } };
  const trimmed = script.trim();
  const level = trimmed.length >= 200 ? 'deep' : 'basic';
  const response = await callDeepSeek({
    ...config,
    systemPrompt: level === 'deep' ? DNA_ANALYSIS_PROMPT : DESCRIPTION_ANALYSIS_PROMPT,
    userContent: buildAnalyzeContent(trimmed, title, desc, tags),
    maxTokens: 16000,
  });
  if (response.status !== 200) return response;

  let result;
  try { result = parseJsonResult(response.content); }
  catch { result = fallbackAnalysis(response.content, script, level); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) result = fallbackAnalysis(String(result), script, level);
  result.level = level;
  result.original = script;
  return { status: 200, body: result };
}

export async function synthesizeAnalyses({ analyses, topic = '', config }) {
  if (!Array.isArray(analyses) || analyses.length < 2) return { status: 400, body: { error: '至少需要2条分析结果才能归纳总结' } };
  const response = await callDeepSeek({
    ...config,
    systemPrompt: buildSynthesisPrompt(analyses, topic),
    userContent: `帮我归纳这${analyses.length}条爆款的共性规律${topic ? `，主题：${topic}` : ''}`,
    maxTokens: 4000,
  });
  if (response.status !== 200) return response;
  try {
    return { status: 200, body: parseJsonResult(response.content) };
  } catch {
    return { status: 500, body: { error: 'AI输出格式异常，请重试' } };
  }
}
