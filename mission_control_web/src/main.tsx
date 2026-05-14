import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { captureBeforeInstallPrompt, registerPwaServiceWorker } from "@/lib/installPrompt";

window.addEventListener("beforeinstallprompt", captureBeforeInstallPrompt);
registerPwaServiceWorker();

createRoot(document.getElementById("root")!).render(<App />);
