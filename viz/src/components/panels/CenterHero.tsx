import { useT } from "../../i18n";

/**
 * 创作空间空态水印（设计稿 01）。
 * 文本视图与编排画布共用同一块，替掉原先两处各写一行的小字提示。
 */
export function CenterHero() {
  const t = useT();
  return (
    <div className="cw-hero" aria-hidden>
      <div className="cw-hero__title">{t("app.title")}</div>
      <div className="cw-hero__sub">{t("app.heroSub")}</div>
    </div>
  );
}
