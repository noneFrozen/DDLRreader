import { useEffect, useRef } from "react";

type UsageGuideProps = {
  onClose: () => void;
};

export function UsageGuide({ onClose }: UsageGuideProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    const previousFocus = document.activeElement as HTMLElement;
    dialogRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="guide-overlay" role="dialog" aria-modal="true" aria-labelledby="guide-title" onClick={onClose}>
      <div className="guide-dialog" ref={dialogRef} tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="guide-dialog__header">
          <h2 id="guide-title">使用指南</h2>
          <button type="button" className="guide-dialog__close" aria-label="关闭使用指南" onClick={onClose}>✕</button>
        </div>
        <div className="guide-dialog__body">
          <div className="guide-step">
            <h3><span className="guide-step__num">01</span> 可用时间</h3>
            <p>选择你所在的时区，勾选每周规律可用的星期，设置每天的开始和结束时间。点击"保存可用时间"后即可进入下一步。如有某天不可用，可在下方添加例外日期。</p>
          </div>
          <div className="guide-step">
            <h3><span className="guide-step__num">02</span> 任务录入</h3>
            <p>填写任务名称、截止时间、预计剩余工时（小时）。可选择优先级（高/中/低）、是否可拆分、最小拆分时长。如有前置任务依赖，可在下方勾选。保存后可继续添加更多任务。</p>
          </div>
          <div className="guide-step">
            <h3><span className="guide-step__num">03</span> 冲突分析</h3>
            <p>系统会根据你的可用时间和任务工作量，自动计算每个截止日前的容量缺口。绿色表示时间充裕，黄色表示紧张，红色表示严重不足。点击"生成尽力计划"即可进入下一步。即使有缺口，系统也会尽力安排。</p>
          </div>
          <div className="guide-step">
            <h3><span className="guide-step__num">04</span> 生成计划</h3>
            <p>系统将任务拆分为30分钟的时间块，按日期排列在时间线上。你可以：</p>
            <ul>
              <li><strong>点击时间块</strong> — 选中后进行编辑</li>
              <li><strong>方向键 ↑↓</strong> — 微调30分钟，Shift+方向键微调60分钟</li>
              <li><strong>拖拽时间块</strong> — 按住拖动到新时段</li>
              <li><strong>锁定</strong> — 防止自动重排时被移动</li>
              <li><strong>开始/完成/跳过</strong> — 标记时间块状态</li>
              <li><strong>拆分</strong> — 将时间块一分为二（需至少60分钟）</li>
              <li><strong>合并相邻</strong> — 将相邻同任务时间块合并</li>
              <li><strong>Ctrl+Z / Ctrl+Shift+Z</strong> — 撤销 / 重做</li>
              <li><strong>导出 ICS</strong> — 下载日历文件，导入常用日历应用</li>
            </ul>
          </div>
          <div className="guide-step">
            <h3><span className="guide-step__num">05</span> 统计看板</h3>
            <p>查看任务总览：活跃/已完成/逾期任务数量、完成率、剩余总工时。环形图展示高中低优先级分布，柱状图展示每日已排工时与可用容量的对比。红色表示当日超负荷。</p>
          </div>
        </div>
      </div>
    </div>
  );
}