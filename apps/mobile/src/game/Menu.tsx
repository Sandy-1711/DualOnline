/**
 * Start menu: choose Practice (local bot) or Online (connect to the server).
 * The server URL defaults to the host that served this page on web, so opening
 * the app via a LAN IP "just works"; on native it defaults to a LAN IP you can
 * edit. Two players entering the same room code land in the same match.
 */
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { playerColor, theme } from "../theme";

export type StartMode =
  | { mode: "local" }
  | { mode: "online"; serverUrl: string; roomId: string };

// The deployed authoritative server. Editable in the menu for local testing
// (use ws://localhost:8787 against `wrangler dev`).
const PRODUCTION_SERVER = "wss://dual-game-server.sandy1711003.workers.dev";

function defaultServerUrl(): string {
  return PRODUCTION_SERVER;
}

export function Menu({ onStart }: { onStart: (s: StartMode) => void }) {
  const [serverUrl, setServerUrl] = useState(defaultServerUrl());
  const [roomId, setRoomId] = useState("alpha");

  return (
    <View style={styles.root}>
      <Text style={styles.title}>
        <Text style={{ color: playerColor(0) }}>DUAL</Text>
        <Text style={{ color: theme.text }}> ONLINE</Text>
      </Text>
      <Text style={styles.subtitle}>one arena · twin-stick · authoritative netcode</Text>

      <Pressable style={[styles.button, styles.primary]} onPress={() => onStart({ mode: "local" })}>
        <Text style={styles.buttonText}>Practice vs Bot</Text>
      </Pressable>

      <View style={styles.fields}>
        <Field label="Room code" value={roomId} onChangeText={setRoomId} autoCapitalize="none" />
        <Field label="Server URL" value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" />
      </View>

      <Pressable
        style={[styles.button, styles.online]}
        onPress={() => onStart({ mode: "online", serverUrl: serverUrl.trim(), roomId: roomId.trim() || "alpha" })}
      >
        <Text style={styles.buttonText}>Play Online</Text>
      </Pressable>
    </View>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  autoCapitalize?: "none" | "sentences";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        autoCapitalize={props.autoCapitalize}
        autoCorrect={false}
        placeholderTextColor={theme.textDim}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 24,
  },
  title: { fontSize: 44, fontWeight: "900", letterSpacing: 2 },
  subtitle: { color: theme.textDim, fontSize: 13, marginBottom: 8 },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 10,
    minWidth: 240,
    alignItems: "center",
  },
  primary: { backgroundColor: "#1f2a3a" },
  online: { backgroundColor: playerColor(0) },
  buttonText: { color: theme.text, fontSize: 17, fontWeight: "700" },
  fields: { gap: 8, marginTop: 6 },
  field: { flexDirection: "row", alignItems: "center", gap: 10 },
  fieldLabel: { color: theme.textDim, width: 90, fontSize: 13 },
  input: {
    color: theme.text,
    backgroundColor: "#0f1622",
    borderColor: theme.arenaBorder,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 220,
  },
});
