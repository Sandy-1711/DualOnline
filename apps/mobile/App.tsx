import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { LocalGame } from "./src/game/LocalGame";
import { Menu, type StartMode } from "./src/game/Menu";
import { OnlineGame } from "./src/game/OnlineGame";
import { theme } from "./src/theme";

export default function App() {
  const [start, setStart] = useState<StartMode | null>(null);

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar hidden />
      {start === null ? (
        <Menu onStart={setStart} />
      ) : (
        <View style={styles.root}>
          {start.mode === "local" ? (
            <LocalGame />
          ) : (
            <OnlineGame serverUrl={start.serverUrl} roomId={start.roomId} />
          )}
          <Pressable style={styles.back} onPress={() => setStart(null)}>
            <Text style={styles.backText}>‹ Menu</Text>
          </Pressable>
        </View>
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  back: {
    position: "absolute",
    top: 12,
    left: 14,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  backText: { color: theme.text, fontWeight: "700", fontSize: 14 },
});
