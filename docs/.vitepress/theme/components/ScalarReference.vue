<template>
  <div class="wats-scalar-reference">
    <ApiReference :configuration="configuration" />
  </div>
</template>

<script setup lang="ts">
import { ApiReference } from "@scalar/api-reference";
import "@scalar/api-reference/style.css";

const configuration = {
  url: "/openapi.json",
  theme: "default",
  hideDownloadButton: false,
  hideModels: false,
  showSidebar: true
};
</script>
