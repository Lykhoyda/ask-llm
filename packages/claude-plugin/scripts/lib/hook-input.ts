export interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  stop_hook_active?: boolean;
  tool_name?: string;
  tool_input?: { file_path?: string };
}
