import EventEmitter from './EventEmitter';

class MediaManager extends EventEmitter {
  constructor() {
    super();
    this.localStream = null;
  }

  async initializeMedia() {
    try {
      if (this.localStream) {
        this.cleanup();
      }
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      
      // 确保视频轨道和音频轨道都已启用
      this.localStream.getTracks().forEach(track => {
        track.enabled = true;
      });
      
      // 立即触发事件
      this.emit('localStreamReady', this.localStream);
      return this.localStream;
    } catch (err) {
      console.error('获取或设置媒体设备失败:', err);
      this.emit('localStreamReady', null);
      throw err;
    }
  }

  async toggleCamera() {
    if (!this.localStream) {
      await this.initializeMedia();
      return true;
    }

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      return videoTrack.enabled;
    }
    return false;
  }

  toggleMic() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return audioTrack.enabled;
      }
    }
    return false;
  }

  toggleParticipantAudio(remoteStream) {
    if (remoteStream) {
      const audioTrack = remoteStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return audioTrack.enabled;
      }
    }
    return false;
  }

  cleanup() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      this.emit('localStreamReady', null);
      this.localStream = null;
    }
  }

  getLocalStream() {
    return this.localStream;
  }
}

export default MediaManager;