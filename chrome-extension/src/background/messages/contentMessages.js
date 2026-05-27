/**
 * 处理来自 content-script 的消息。
 *
 * 当前版本未定义 content-script 专用消息类型，统一返回 unknown。
 */
export async function handleContentMessage() {
  return { ok: false, error: 'unknown_message_type' };
}
