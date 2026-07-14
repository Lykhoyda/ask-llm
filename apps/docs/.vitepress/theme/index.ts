import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import Layout from "./Layout.vue";
import DiagramModal from "../components/DiagramModal.vue";
import SetupTabs from "../components/SetupTabs.vue";
import InAction from "../components/InAction.vue";
import TroubleshootingModal from "../components/TroubleshootingModal.vue";
import RequestFlow from "../components/diagrams/RequestFlow.vue";
import PairLoop from "../components/diagrams/PairLoop.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component("DiagramModal", DiagramModal);
    app.component("SetupTabs", SetupTabs);
    app.component("InAction", InAction);
    app.component("TroubleshootingModal", TroubleshootingModal);
    app.component("RequestFlow", RequestFlow);
    app.component("PairLoop", PairLoop);
  },
} satisfies Theme;
