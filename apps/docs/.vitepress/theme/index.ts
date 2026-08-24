import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import DiagramModal from "../components/DiagramModal.vue";
import FallbackChain from "../components/diagrams/FallbackChain.vue";
import FanOut from "../components/diagrams/FanOut.vue";
import PairLoop from "../components/diagrams/PairLoop.vue";
import RequestFlow from "../components/diagrams/RequestFlow.vue";
import SessionThread from "../components/diagrams/SessionThread.vue";
import InstallSnippet from "../components/InstallSnippet.vue";
import NoirHero from "../components/NoirHero.vue";
import ProviderChips from "../components/ProviderChips.vue";
import ProviderStatus from "../components/ProviderStatus.vue";
import ReviewLoop from "../components/ReviewLoop.vue";
import SetupTabs from "../components/SetupTabs.vue";
import TroubleshootingModal from "../components/TroubleshootingModal.vue";
import Layout from "./Layout.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component("DiagramModal", DiagramModal);
    app.component("SetupTabs", SetupTabs);
    app.component("InstallSnippet", InstallSnippet);
    app.component("ProviderStatus", ProviderStatus);
    app.component("NoirHero", NoirHero);
    app.component("ReviewLoop", ReviewLoop);
    app.component("ProviderChips", ProviderChips);
    app.component("TroubleshootingModal", TroubleshootingModal);
    app.component("RequestFlow", RequestFlow);
    app.component("PairLoop", PairLoop);
    app.component("FanOut", FanOut);
    app.component("FallbackChain", FallbackChain);
    app.component("SessionThread", SessionThread);
  },
} satisfies Theme;
