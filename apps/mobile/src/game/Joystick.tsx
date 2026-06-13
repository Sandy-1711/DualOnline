/**
 * A virtual thumbstick. Drag within the base; reports a direction vector whose
 * magnitude is 0..1. Releasing snaps the knob home and reports magnitude 0.
 *
 * Gesture callbacks run on the JS thread (`runOnJS(true)`) so they can call the
 * plain `onChange` callback directly — the values feed the game loop's input.
 */
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

const BASE_RADIUS = 60;
const KNOB_RADIUS = 28;

export interface StickValue {
  /** Unit-ish direction; (0,0) when centered. */
  x: number;
  y: number;
  /** 0..1 push magnitude. */
  magnitude: number;
  /** True while a finger/pointer is on the stick, even without dragging. */
  pressed: boolean;
}

interface Props {
  side: "left" | "right";
  color: string;
  onChange: (value: StickValue) => void;
}

export function Joystick({ side, color, onChange }: Props) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const update = useCallback(
    (tx: number, ty: number) => {
      const dist = Math.hypot(tx, ty);
      const clamped = Math.min(dist, BASE_RADIUS);
      const nx = dist === 0 ? 0 : tx / dist;
      const ny = dist === 0 ? 0 : ty / dist;
      setKnob({ x: nx * clamped, y: ny * clamped });
      onChange({ x: nx, y: ny, magnitude: clamped / BASE_RADIUS, pressed: true });
    },
    [onChange],
  );

  const reset = useCallback(() => {
    setKnob({ x: 0, y: 0 });
    onChange({ x: 0, y: 0, magnitude: 0, pressed: false });
  }, [onChange]);

  // minDistance(0) makes the gesture activate on touch-down (no drag needed),
  // so onBegin/onUpdate fire immediately — a press counts even if you don't move.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => update(e.translationX, e.translationY))
    .onUpdate((e) => update(e.translationX, e.translationY))
    .onFinalize(reset);

  return (
    <GestureDetector gesture={pan}>
      <View
        style={[
          styles.base,
          side === "left" ? styles.left : styles.right,
          { borderColor: color },
        ]}
      >
        <View
          style={[
            styles.knob,
            { backgroundColor: color, transform: [{ translateX: knob.x }, { translateY: knob.y }] },
          ]}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  base: {
    position: "absolute",
    bottom: 28,
    width: BASE_RADIUS * 2,
    height: BASE_RADIUS * 2,
    borderRadius: BASE_RADIUS,
    borderWidth: 2,
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
  },
  left: { left: 32 },
  right: { right: 32 },
  knob: {
    width: KNOB_RADIUS * 2,
    height: KNOB_RADIUS * 2,
    borderRadius: KNOB_RADIUS,
    opacity: 0.9,
  },
});
