import React from "react"
import { useCycleEvents, useCycleState } from "../../hooks/useCycleState"
import { useEpochHistory } from "../../hooks/useEpochHistory"
import { toActivityList, toCycleRows, toEpochList } from "../../pages/cycle"
import CycleSurface from "./CycleSurface"

const CycleSection: React.FC = () => {
	const { cycle } = useCycleState()
	const { history } = useEpochHistory()
	const { cycleEvents } = useCycleEvents()

	return (
		<CycleSurface
			groups={toCycleRows(cycle)}
			unreadable={cycle.status === "unreadable"}
			epochs={toEpochList(history)}
			activity={toActivityList(cycleEvents)}
		/>
	)
}

export default CycleSection
