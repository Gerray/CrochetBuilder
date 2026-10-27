import React from "react";
import { createRoot } from "react-dom/client";
import { ViewerApp } from "./ViewerApp.js";
import "../styles.css";
import "./viewer.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ViewerApp />
  </React.StrictMode>,
);
