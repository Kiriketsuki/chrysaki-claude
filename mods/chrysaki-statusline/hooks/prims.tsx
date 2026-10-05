// Drawing primitives the header and the ledger share. No I/O happens here.

import type { Elements, RenderElement } from 'claude-code'

import { CORE, ROLE } from './palette'

export type Table = Elements[keyof Elements]

// A group that shows a card one row above it while hovered.
export function hoverGroup(T: Table, key: string, card: string, children: RenderElement[]): RenderElement {
  const { Box, Text } = T
  return (
    <Box key={key}>
      {children}
      <Box position="absolute" top={-1} left={0} display="none" hover={{ display: 'flex' }} backgroundColor={CORE.elevated} paddingX={1}>
        <Text color={ROLE.text}>{card}</Text>
      </Box>
    </Box>
  )
}

export function spaces(T: Table, n: number): RenderElement {
  const { Text } = T
  return <Text>{' '.repeat(Math.max(0, n))}</Text>
}

export function truncate(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + '…'
}
