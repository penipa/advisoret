import { TextInput, TextInputProps, View, ViewStyle } from "react-native";
import { theme } from "../theme";

export function TInput(props: TextInputProps & { containerStyle?: ViewStyle }) {
  const { style, containerStyle, placeholderTextColor, ...rest } = props;

  return (
    <View
      style={[
        {
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          paddingHorizontal: 12,
          paddingVertical: 10,
        },
        containerStyle,
      ]}
    >
      <TextInput
        {...rest}
        placeholderTextColor={placeholderTextColor ?? theme.colors.textMuted}
        style={[
          {
            color: theme.colors.text,
            fontSize: theme.font.body,
            padding: 0,
          },
          style as any,
        ]}
      />
    </View>
  );
}
