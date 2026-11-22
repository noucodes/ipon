import { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme, radius } from '../theme';

/**
 * Tinder-style card: drag the whole card LEFT = expense, RIGHT = income.
 * Taps inside (keypad, chips) still work; only a clearly horizontal drag grabs the card.
 * If `canSwipe` is false the card wiggles back and `onBlocked` is called.
 */
export function SwipeCard({ children, canSwipe, onSwipe, onBlocked, leftLabel = 'EXPENSE', rightLabel = 'INCOME' }) {
  const t = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const [width, setWidth] = useState(360);
  const passed = useRef(false);
  const threshold = width * 0.28;

  const reset = () => {
    x.setValue(0);
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  };

  const complete = (dir) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Animated.timing(x, { toValue: (dir === 'right' ? 1 : -1) * width * 1.4, duration: 200, useNativeDriver: true }).start(() => {
      onSwipe(dir);
      setTimeout(reset, 350); // hidden behind the success screen, or back for another try
    });
  };

  const pan = useMemo(() => {
    const horizontal = (_, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6;
    return PanResponder.create({
      // Capture so a sideways drag that starts on a keypad key still moves the card.
      onMoveShouldSetPanResponderCapture: horizontal,
      onMoveShouldSetPanResponder: horizontal,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { passed.current = false; },
      onPanResponderMove: (_, g) => {
        const dx = canSwipe ? g.dx : g.dx * 0.25; // resist when there's nothing to save
        x.setValue(dx);
        const over = Math.abs(dx) > threshold;
        if (over !== passed.current) {
          passed.current = over;
          if (over) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
      },
      onPanResponderRelease: (_, g) => {
        const fling = Math.abs(g.vx) > 0.9 && Math.abs(g.dx) > threshold * 0.4;
        if (canSwipe && (Math.abs(g.dx) > threshold || fling)) {
          complete(g.dx > 0 ? 'right' : 'left');
        } else {
          if (!canSwipe && Math.abs(g.dx) > 30) onBlocked?.();
          Animated.spring(x, { toValue: 0, friction: 6, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: true }).start(),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSwipe, threshold, width]);

  const rotate = x.interpolate({ inputRange: [-width, 0, width], outputRange: ['-14deg', '0deg', '14deg'] });
  const leftStamp = x.interpolate({ inputRange: [-threshold, -20, 0], outputRange: [1, 0, 0], extrapolate: 'clamp' });
  const rightStamp = x.interpolate({ inputRange: [0, 20, threshold], outputRange: [0, 0, 1], extrapolate: 'clamp' });

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Animated.View
        {...pan.panHandlers}
        accessible={false}
        accessibilityActions={[{ name: 'left', label: `Save as ${leftLabel.toLowerCase()}` }, { name: 'right', label: `Save as ${rightLabel.toLowerCase()}` }]}
        onAccessibilityAction={(e) => (canSwipe ? complete(e.nativeEvent.actionName) : onBlocked?.())}
        style={{
          flex: 1,
          backgroundColor: t.card,
          borderRadius: 30,
          padding: 16,
          gap: 12,
          opacity,
          transform: [{ translateX: x }, { rotate }],
          elevation: 4,
          shadowColor: '#000',
          shadowOpacity: 0.12,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
        }}
      >
        {children}

        {/* Stamps */}
        <Animated.View pointerEvents="none" style={[stamp, { left: 18, borderColor: t.income, opacity: rightStamp, transform: [{ rotate: '-14deg' }] }]}>
          <Text style={[stampText, { color: t.income }]}>{rightLabel}</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[stamp, { right: 18, borderColor: t.expense, opacity: leftStamp, transform: [{ rotate: '14deg' }] }]}>
          <Text style={[stampText, { color: t.expense }]}>{leftLabel}</Text>
        </Animated.View>
      </Animated.View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8, paddingTop: 10 }} pointerEvents="none">
        <Text style={{ color: t.expense, fontWeight: '800' }}>‹ swipe for expense</Text>
        <Text style={{ color: t.income, fontWeight: '800' }}>income ›</Text>
      </View>
    </View>
  );
}

const stamp = { position: 'absolute', top: 70, borderWidth: 4, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 4 };
const stampText = { fontSize: 30, fontWeight: '900', letterSpacing: 2 };
