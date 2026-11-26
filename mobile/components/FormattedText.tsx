import { parseFormattedText } from '@pomodoso/types';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontMono } from '@/constants/theme';

/** Renders the Markdown subset the format buttons write (see text-format.ts). */
export function FormattedText({ text, placeholder }: { text: string; placeholder?: string }): React.JSX.Element {
  if (!text.trim()) return <Text style={[styles.line, styles.placeholder]}>{placeholder ?? ''}</Text>;
  return (
    <View>
      {parseFormattedText(text).map((block, i) => (
        <View key={i} style={block.bullet ? styles.bulletRow : undefined}>
          {block.bullet && <Text style={styles.line}>•</Text>}
          <Text style={[styles.line, block.bullet && styles.bulletText]}>
            {block.spans.length === 0
              ? ' '
              : block.spans.map((span, j) => (
                  <Text
                    key={j}
                    style={[span.bold && styles.bold, span.italic && styles.italic, span.code && styles.code]}
                  >
                    {span.text}
                  </Text>
                ))}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: 14, lineHeight: 21, color: colors.text },
  placeholder: { color: colors.textTertiary, fontStyle: 'italic' },
  bulletRow: { flexDirection: 'row', gap: 8, paddingLeft: 4 },
  bulletText: { flex: 1 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  code: { fontFamily: fontMono, fontSize: 13, backgroundColor: colors.bg, color: colors.accent },
});
