declare module 'claude-code' {
  interface PluginState {
    'chrysaki-stretch': {
      /** Per paragraph of a reply drawn by a Client: the keys of the stretches the reader has open. */
      open: StateFamily<string[]>
      /** Short forms of the stretches the reader opened since their last prompt. */
      seen: string[]
      /** Per group of tool calls: whether the reader opened it. */
      groups: StateFamily<boolean>
    }
  }
}
