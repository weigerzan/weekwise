export async function requestJSON({ key, model, messages, signal, fetcher = fetch, parse, repair }) {
  const timeout = AbortSignal.timeout(120000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (requestSignal.aborted) throw new Error(signal?.aborted ? 'AI 规划已取消' : 'AI 请求超时，请稍后重试');
    let response;
    try {
      response = await fetcher('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, max_tokens: 12000, stream: false }), signal: requestSignal });
    } catch (error) { throw new Error(signal?.aborted ? 'AI 规划已取消' : requestSignal.aborted || error.name === 'TimeoutError' || error.name === 'AbortError' ? 'AI 请求超时，请稍后重试' : '无法连接 DeepSeek，请检查网络'); }
    if (!response.ok) {
      const errors = { 401: 'API 密钥无效，请检查设置', 402: 'DeepSeek 账户余额不足', 429: '请求过于频繁，请稍后重试', 400: '请求不被支持，请检查模型名称' };
      throw new Error(errors[response.status] || `DeepSeek 服务暂时不可用（${response.status}）`);
    }
    let result;
    try { result = await response.json(); } catch { throw new Error('DeepSeek 返回了无法读取的响应'); }
    if (signal?.aborted) throw new Error('AI 规划已取消');
    if (result.choices?.[0]?.finish_reason !== 'stop') throw new Error('AI 响应未完成，可能任务过多，请缩小规划范围');
    try {
      let value;
      try { value = JSON.parse(result.choices[0].message?.content); } catch { throw new Error('AI 未返回有效的 JSON 计划'); }
      return parse(value);
    } catch (error) {
      if (attempt === 1) throw new Error(`AI 计划自动校正后仍未通过校验：${error.message.replace(/[。\s]+$/u, '')}。当前任务保持原样`);
      if (signal?.aborted) throw new Error('AI 规划已取消');
      messages.push({ role: 'user', content: repair(error) });
    }
  }
}
