import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme, space, radius } from '../theme';
import { formatPHP } from '../lib/format';

export { Ionicons };

export function Screen({ children, scroll = true, edges = ['top'], contentStyle, refreshControl, ...rest }) {
  const t = useTheme();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[{ padding: space.lg, paddingBottom: 96, gap: space.md }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
  );
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: t.bg }} {...rest}>
      {body}
    </SafeAreaView>
  );
}

export function Title({ children, right }) {
  const t = useTheme();
  return (
    <View style={styles.row}>
      <Text style={{ fontSize: 26, fontWeight: '700', color: t.text, flex: 1 }}>{children}</Text>
      {right}
    </View>
  );
}

export function Label({ children, style }) {
  const t = useTheme();
  return <Text style={[{ fontSize: 13, fontWeight: '600', color: t.muted, textTransform: 'uppercase', letterSpacing: 0.5 }, style]}>{children}</Text>;
}

export function Body({ children, muted, style, ...rest }) {
  const t = useTheme();
  return <Text style={[{ fontSize: 15, color: muted ? t.muted : t.text }, style]} {...rest}>{children}</Text>;
}

export function Card({ children, style, onPress }) {
  const t = useTheme();
  const s = [{ backgroundColor: t.card, borderRadius: radius.lg, padding: space.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, gap: space.sm }, style];
  if (onPress) {
    return <Pressable onPress={onPress} style={({ pressed }) => [s, pressed && { opacity: 0.7 }]}>{children}</Pressable>;
  }
  return <View style={s}>{children}</View>;
}

/** Peso amount, coloured by sign or kind. */
export function Money({ cents, size = 15, kind, signed, style, weight = '600' }) {
  const t = useTheme();
  const color = kind === 'income' ? t.income : kind === 'expense' ? t.expense : kind === 'transfer' ? t.transfer : cents < 0 ? t.expense : t.text;
  const prefix = signed ? (kind === 'income' ? '+' : kind === 'expense' ? '−' : '') : '';
  const text = signed ? formatPHP(Math.abs(cents)) : formatPHP(cents);
  return <Text style={[{ fontSize: size, fontWeight: weight, color, fontVariant: ['tabular-nums'] }, style]}>{prefix}{text}</Text>;
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style }) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.primary : variant === 'danger' ? 'transparent' : t.chip;
  const fg = variant === 'primary' ? t.primaryText : variant === 'danger' ? t.danger : t.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        variant === 'danger' && { borderWidth: 1, borderColor: t.danger },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon && <Ionicons name={icon} size={18} color={fg} />}
          <Text style={{ color: fg, fontSize: 16, fontWeight: '700' }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, color }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={10} style={({ pressed }) => [{ padding: 6, opacity: pressed ? 0.6 : 1 }]}>
      <Ionicons name={icon} size={24} color={color ?? t.primary} />
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, icon, color }) {
  const t = useTheme();
  const accent = color ?? t.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? accent : t.chip, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      {icon && <Ionicons name={icon} size={15} color={selected ? t.primaryText : t.muted} />}
      <Text style={{ color: selected ? t.primaryText : t.text, fontWeight: selected ? '700' : '500', fontSize: 14 }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** Horizontal scrolling row of chips. */
export function ChipRow({ children }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      // ScrollView grows to fill its parent by default; keep the row chip-height.
      style={{ flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={{ gap: space.sm, paddingRight: space.lg, alignItems: 'center' }}
    >
      {children}
    </ScrollView>
  );
}

/** Equal-width segmented control. options: [{ value, label, color? }] */
export function Segmented({ options, value, onChange }) {
  const t = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: t.chip }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && { backgroundColor: o.color ?? t.card }]}
          >
            <Text style={{ fontWeight: '700', color: active ? (o.color ? '#fff' : t.text) : t.muted }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ label, error, style, ...input }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label && <Label>{label}</Label>}
      <TextInput
        placeholderTextColor={t.muted}
        style={[styles.input, { backgroundColor: t.card, color: t.text, borderColor: error ? t.danger : t.border }, style]}
        {...input}
      />
      {error && <Text style={{ color: t.danger, fontSize: 13 }}>{error}</Text>}
    </View>
  );
}

export function ToggleRow({ label, hint, value, onValueChange, disabled }) {
  const t = useTheme();
  return (
    <View style={[styles.row, { gap: space.md, opacity: disabled ? 0.5 : 1 }]}>
      <View style={{ flex: 1 }}>
        <Body>{label}</Body>
        {hint && <Body muted style={{ fontSize: 13 }}>{hint}</Body>}
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ true: t.primary }} />
    </View>
  );
}

export function ErrorText({ error }) {
  const t = useTheme();
  if (!error) return null;
  return (
    <View style={[styles.row, { gap: 8, backgroundColor: t.chip, padding: space.md, borderRadius: radius.md }]}>
      <Ionicons name="alert-circle" size={18} color={t.danger} />
      <Text style={{ color: t.danger, flex: 1 }}>{error.message ?? String(error)}</Text>
    </View>
  );
}

export function Loading() {
  const t = useTheme();
  return <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={t.primary} /></View>;
}

export function Empty({ icon = 'sparkles-outline', title, hint, action }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: space.xl, gap: space.sm }}>
      <Ionicons name={icon} size={36} color={t.muted} />
      <Body style={{ fontWeight: '700' }}>{title}</Body>
      {hint && <Body muted style={{ textAlign: 'center' }}>{hint}</Body>}
      {action}
    </View>
  );
}

/** Floating "+" button. */
export function Fab({ onPress, label = 'Add transaction' }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.fab, { backgroundColor: t.primary, opacity: pressed ? 0.85 : 1 }]}
    >
      <Ionicons name="add" size={30} color={t.primaryText} />
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  button: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 18, borderRadius: radius.md, minHeight: 50 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill, maxWidth: 220 },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 4 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.sm },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  fab: { position: 'absolute', right: 20, bottom: 20, width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
});

// ---------- Settings-style grouped lists ----------

/** Grouped list section: small caps title, rounded card of rows with dividers, optional footnote. */
export function Section({ title, footer, children }) {
  const t = useTheme();
  const items = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  return (
    <View style={{ gap: 8 }}>
      {title && (
        <Text style={{ fontSize: 12, fontWeight: '700', color: t.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginLeft: 8 }}>{title}</Text>
      )}
      <View style={{ backgroundColor: t.card, borderRadius: radius.lg, overflow: 'hidden' }}>
        {items.map((child, i) => (
          <View key={child.key ?? i}>
            {i > 0 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginLeft: 62 }} />}
            {child}
          </View>
        ))}
      </View>
      {footer && <Text style={{ fontSize: 12, color: t.muted, marginHorizontal: 8, lineHeight: 17 }}>{footer}</Text>}
    </View>
  );
}

/** One row: coloured icon tile, label + optional hint, and a right-hand element or chevron. */
export function Row({ icon, iconColor, label, hint, onPress, right, danger, chevron }) {
  const t = useTheme();
  const tint = danger ? t.danger : iconColor ?? t.primary;
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, minHeight: 60 }}>
      {icon && (
        <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={18} color="#fff" />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: danger ? t.danger : t.text }}>{label}</Text>
        {hint ? <Text style={{ fontSize: 13, color: t.muted, lineHeight: 18 }}>{hint}</Text> : null}
      </View>
      {right}
      {(chevron ?? (!!onPress && !right)) && <Ionicons name="chevron-forward" size={18} color={t.muted} />}
    </View>
  );
  if (!onPress) return content;
  return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ backgroundColor: pressed ? t.chip : 'transparent' })}>{content}</Pressable>;
}

export function SwitchRow({ value, onValueChange, disabled, ...row }) {
  const t = useTheme();
  return (
    <View style={{ opacity: disabled ? 0.5 : 1 }}>
      <Row {...row} right={<Switch value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ true: t.accent }} />} />
    </View>
  );
}

/** Name on the left (wraps up to 2 lines), amount pinned on the right: long names never push the amount off-screen. */
export function NameAmount({ name, children, style }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 3 }, style]}>
      <Body style={{ flex: 1 }} numberOfLines={2}>{name}</Body>
      <View style={{ flexShrink: 0 }}>{children}</View>
    </View>
  );
}
