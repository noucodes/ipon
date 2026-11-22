import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from './ui';
import { useTheme, space, radius } from '../theme';

const ROWS = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['.', '0', 'del']];
const MAX_LEN = 24;

/**
 * Amount entry with + and − so you can add things up ("120+45-10").
 * Returns { expr, cents, onKey, reset, set } where cents is the evaluated total.
 */
export function useAmountInput(initialCents = 0) {
  const [expr, setExpr] = useState(initialCents ? String(initialCents / 100) : '');

  const onKey = useCallback((k) => {
    setExpr((e) => {
      if (k === 'del') return e.slice(0, -1);
      if (k === 'clear') return '';
      const last = e.slice(-1);
      const current = e.split(/[+-]/).pop(); // number being typed
      if (k === '+' || k === '-') {
        if (!e) return e; // can't start with an operator
        if (last === '+' || last === '-') return e.slice(0, -1) + k; // swap operator
        if (last === '.') return e.slice(0, -1) + k;
        return e.length < MAX_LEN ? e + k : e;
      }
      if (k === '.') {
        if (current.includes('.')) return e;
        return e + (current === '' ? '0.' : '.');
      }
      // digit
      if (/\.\d\d$/.test(current)) return e; // max 2 decimals
      if (current === '0') return e.slice(0, -1) + k; // no leading zeros
      return e.length < MAX_LEN ? e + k : e;
    });
  }, []);

  return { expr, cents: evaluate(expr), hasOperator: /\d[+-]/.test(expr), onKey, reset: () => setExpr(''), set: setExpr };
}

/** Sum of a "+/-" expression in centavos (never negative). */
export function evaluate(expr) {
  const parts = expr.match(/[+-]?[^+-]+/g) ?? [];
  let total = 0;
  for (const p of parts) {
    const n = Number(p);
    if (Number.isFinite(n)) total += Math.round(n * 100);
  }
  return Math.max(0, total);
}

export function Keypad({ onKey, showOperators = true }) {
  const t = useTheme();
  const press = (k) => {
    Haptics.selectionAsync().catch(() => {});
    onKey(k);
  };
  const Key = ({ k, children, label }) => (
    <Pressable
      onPress={() => press(k)}
      onLongPress={k === 'del' ? () => press('clear') : undefined}
      accessibilityRole="button"
      accessibilityLabel={label ?? k}
      style={({ pressed }) => ({
        flex: 1,
        height: 56,
        borderRadius: radius.md,
        backgroundColor: pressed ? t.chip : t.key,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      {children ?? <Text style={{ fontSize: 26, fontWeight: '600', color: t.text }}>{k}</Text>}
    </Pressable>
  );

  return (
    <View style={{ gap: space.sm }}>
      {showOperators && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 48, paddingVertical: 2 }}>
          {['+', '-'].map((op) => (
            <Pressable key={op} onPress={() => press(op)} hitSlop={14} accessibilityLabel={op === '+' ? 'plus' : 'minus'}>
              <Text style={{ fontSize: 26, color: t.muted, fontWeight: '500' }}>{op === '-' ? '−' : op}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {ROWS.map((row) => (
        <View key={row.join('')} style={{ flexDirection: 'row', gap: space.sm }}>
          {row.map((k) =>
            k === 'del' ? (
              <Key key={k} k={k} label="Delete (hold to clear)">
                <Ionicons name="backspace-outline" size={26} color={t.text} />
              </Key>
            ) : (
              <Key key={k} k={k} />
            ),
          )}
        </View>
      ))}
    </View>
  );
}
