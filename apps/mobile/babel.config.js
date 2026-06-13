module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Reanimated 4 ships its worklet transform in react-native-worklets.
    // This plugin MUST be listed last.
    plugins: ["react-native-worklets/plugin"],
  };
};
