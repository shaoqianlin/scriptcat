export function repairJson(value) {
  let repaired = value;
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escaped = false;

  for (const character of repaired) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === '{') braces += 1;
    if (character === '}') braces -= 1;
    if (character === '[') brackets += 1;
    if (character === ']') brackets -= 1;
  }

  while (brackets > 0) {
    repaired += ']';
    brackets -= 1;
  }
  while (braces > 0) {
    repaired += '}';
    braces -= 1;
  }
  return JSON.parse(repaired.replace(/,(\s*[}\]])/g, '$1'));
}

export function parseJsonResult(content) {
  let json = String(content || '').trim();
  const match = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) json = match[1].trim();

  try {
    return JSON.parse(json);
  } catch {
    return repairJson(json);
  }
}
