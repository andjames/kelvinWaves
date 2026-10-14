/* Global scrollama */
(() => {
  "use strict";
  window.DemoScroll = ({ onIntroProgress, onScene }) => {
    const intro = scrollama().setup({ step: ".demo-scene--intro .demo-story-step", offset: .35, progress: true })
      .onStepEnter(({ element }) => onScene(element.dataset.scene, element.dataset.highlight || ""))
      .onStepProgress(({ element, progress }) => onIntroProgress(element.dataset.scene === "hero" ? progress * .42 : .42 + progress * .58));
    const calendar = scrollama().setup({ step: '[data-scene="calendar"]', offset: .55 })
      .onStepEnter(({ element }) => onScene("calendar", element.dataset.highlight || ""));
    const focus = scrollama().setup({ step: '[data-scene="focus"]', offset: .55 })
      .onStepEnter(({ element }) => onScene("focus", element.dataset.highlight || ""));
    const satellite = scrollama().setup({ step: '[data-scene="satellite"]', offset: .55 })
      .onStepEnter(({ element }) => onScene("satellite", element.dataset.highlight || ""));
    return { resize: () => [intro, calendar, focus, satellite].forEach(instance => instance.resize()) };
  };
})();
