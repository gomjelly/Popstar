// 인식이 끊기면 자동 일시정지(FR-COM-05). 게임 화면들이 함께 쓴다.
// 참가자 중 한 명이라도 lostPlayerPauseMs(2초)보다 오래 안 보이면 멈추고 "카메라 앞으로 돌아와요"를 띄운다.
// 자동으로 멈춘 경우에는 모두 돌아와 1초가 지나면 이어서 한다.

import { $, type App } from '../app';
import { config } from '../config';

export class AutoPause {
  private auto = false;
  private backSince = 0;

  constructor(private app: App) {}

  reset(): void {
    this.auto = false;
    this.backSince = 0;
  }

  /** count = 지켜볼 참가자 수(슬롯 0..count-1) */
  update(now: number, count: number): void {
    const app = this.app;
    const t = app.tracker;
    if (!app.paused) {
      this.auto = false;
      $('pauseTitle').textContent = '잠깐 멈췄어요';
    }
    const slots = t.slots.slice(0, count);
    const lost = slots.some((s) => t.lostMs(s, now) > config.common.lostPlayerPauseMs);
    if (lost && !app.paused) {
      this.auto = true;
      this.backSince = 0;
      app.setPaused(true, '카메라 앞으로 돌아와요');
      $('pauseTitle').textContent = '어디 갔어요?';
    }
    if (this.auto && app.paused) {
      const allBack = slots.every((s) => s.present);
      if (!allBack) this.backSince = 0;
      else if (!this.backSince) this.backSince = now;
      else if (now - this.backSince > 1000) {
        this.auto = false;
        this.backSince = 0;
        app.setPaused(false);
        app.sound.play('join');
        app.log('auto-resumed');
      }
    }
  }
}
