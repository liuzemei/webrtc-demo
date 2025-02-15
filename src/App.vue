<script setup>
import VideoChat from './components/VideoChat.vue';
</script>

<template>
  <div class="app">
    <h1>WebRTC 视频通话</h1>
    <VideoChat />
  </div>
</template>

<style scoped>
.app {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

h1 {
  text-align: center;
  margin-bottom: 30px;
  color: #333;
}
</style>
