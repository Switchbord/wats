import DefaultTheme from "vitepress/theme";
import ScalarReference from "./components/ScalarReference.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("ScalarReference", ScalarReference);
  }
};
