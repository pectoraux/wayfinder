"use client"

import { useWayfinder } from "@/components/wayfinder/store"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Calendar, RotateCcw, History } from "lucide-react"
import { cn } from "@/lib/utils"

/** Historical mode picker: lets the user (or admin/dev) evaluate the plan
 *  against the policy snapshot active on a specific date. */
export function HistoricalModePicker() {
  const asOfDate = useWayfinder((s) => s.asOfDate)
  const setAsOfDate = useWayfinder((s) => s.setAsOfDate)
  const computePlan = useWayfinder((s) => s.computePlan)
  const plan = useWayfinder((s) => s.plan)

  const today = new Date().toISOString().slice(0, 10)
  const isHistorical = asOfDate !== null

  const handleApply = async () => {
    if (plan) {
      // Recompute the current plan under the new asOfDate
      await computePlan()
    }
  }

  const handleReset = () => {
    setAsOfDate(null)
    if (plan) {
      // Recompute under today's policy on the next tick
      setTimeout(() => computePlan(), 0)
    }
  }

  return (
    <div className={cn(
      "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
      isHistorical
        ? "border-accent/40 bg-accent/5"
        : "border-border/60 bg-background/40",
    )}>
      <History className={cn("h-3.5 w-3.5", isHistorical ? "text-accent" : "text-muted-foreground")} />
      <Label className="text-[10px] font-medium text-muted-foreground">As of</Label>
      <Input
        type="date"
        value={asOfDate ?? today}
        onChange={(e) => setAsOfDate(e.target.value)}
        className="h-7 w-36 border-border/60 text-xs"
      />
      {isHistorical && (
        <>
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-[10px]" onClick={handleApply}>
            <Calendar className="h-3 w-3" /> Recompute
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-[10px]" onClick={handleReset}>
            <RotateCcw className="h-3 w-3" /> Today
          </Button>
        </>
      )}
    </div>
  )
}
