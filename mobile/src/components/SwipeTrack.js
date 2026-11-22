import { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from './ui';
import { useTheme, radius } from '../theme';

const THUMB = 60;
const PAD = 5;

/**
 * Swipe-to-confirm track.
 *  mode="both"  : thumb starts in the middle. Swipe LEFT = expense, RIGHT = income.
 *  mode="right" : thumb starts on the left. Swipe RIGHT = confirm (transfer).
 * Calls onComplete('left' | 'right'). Screen readers get equivalent actions.
 */
export function SwipeTrack({ mode = 'both', onComplete, disabled, leftLabel = 'Expense', rightLabel = 'Income', hint }) {
  const t = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  const both = mode === 'both';
  const max = Math.max(1, both ? (width - THUMB) / 2 - PAD : width - THUMB - PAD * 2);
  // Latest callback/state without rebuilding the pan handler mid-drag (stale values bug).
  const onCompleteRef = useRef(onComplete);
  const disabledRef = useRef(disabled);
  onCompleteRef.current = onComplete;
  disabledRef.current = disabled;

  const finish = (dir) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onCompleteRef.current?.(dir);
    // slide back so the track is ready again (the success screen covers it meanwhile)
    setTimeout(() => Animated.spring(x, { toValue: 0, useNativeDriver: false }).start(), 400);
  };

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabledRef.current,
    onMoveShouldSetPanResponder: (_, g) => !disabledRef.current && Math.abs(g.dx) > 4,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => x.setValue(Math.min(max, Math.max(both ? -max : 0, g.dx))),
    onPanResponderRelease: (_, g) => {
      const dx = Math.min(max, Math.max(both ? -max : 0, g.dx));
      const done = Math.abs(dx) > max * 0.7 || (Math.abs(g.vx) > 1.2 && Math.abs(dx) > max * 0.35);
      if (done) {
        const dir = dx > 0 ? 'right' : 'left';
        Animated.timing(x, { toValue: dir === 'right' ? max : -max, duration: 120, useNativeDriver: false }).start(() => finish(dir));
      } else {
        Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
      }
    },
    onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: false }).start(),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [max, both]);

  const bg = both
    ? x.interpolate({ inputRange: [-max, 0, max], outputRange: [t.expense, t.chip, t.income] })
    : x.interpolate({ inputRange: [0, max], outputRange: [t.chip, t.transfer] });
  const thumbLeft = both ? (width - THUMB) / 2 : PAD;
  const thumbIcon = both ? 'swap-horizontal' : 'arrow-forward';
  const thumbColor = both
    ? x.interpolate({ inputRange: [-max, 0, max], outputRange: [t.expense, t.primary, t.income] })
    : t.transfer;

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={both ? `Swipe left for ${leftLabel}, right for ${rightLabel}` : `Slide to ${rightLabel}`}
      accessibilityActions={both ? [{ name: 'left', label: leftLabel }, { name: 'right', label: rightLabel }] : [{ name: 'right', label: rightLabel }]}
      onAccessibilityAction={(e) => !disabled && finish(e.nativeEvent.actionName)}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Animated.View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ height: THUMB + PAD * 2, borderRadius: radius.pill, backgroundColor: bg, justifyContent: 'center' }}
      >
        {both ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 22 }} pointerEvents="none">
            <Text style={{ color: t.text, fontWeight: '700', fontSize: 15 }}>‹ {leftLabel}</Text>
            <Text style={{ color: t.text, fontWeight: '700', fontSize: 15 }}>{rightLabel} ›</Text>
          </View>
        ) : (
          <Text pointerEvents="none" style={{ textAlign: 'center', color: t.text, fontWeight: '700', fontSize: 15 }}>
            Slide to {rightLabel.toLowerCase()} ›
          </Text>
        )}
        <Animated.View
          {...pan.panHandlers}
          style={{
            position: 'absolute',
            left: thumbLeft,
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: thumbColor,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ translateX: x }],
            elevation: 3,
          }}
        >
          <Ionicons name={thumbIcon} size={26} color="#fff" />
        </Animated.View>
      </Animated.View>
      {hint ? <Text style={{ textAlign: 'center', color: t.muted, fontSize: 12, marginTop: 6 }}>{hint}</Text> : null}
    </View>
  );
}
