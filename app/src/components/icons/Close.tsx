import React from "react"

type IconProps = {
	className?: string
}

const Close: React.FC<IconProps> = ({ className }) => (
	<svg
		className={className}
		viewBox="0 0 15 15"
		fill="none"
		aria-hidden="true"
		focusable="false"
	>
		<path
			stroke="currentColor"
			strokeWidth="1.3"
			strokeLinecap="round"
			d="M3.5 3.5L11.5 11.5M11.5 3.5L3.5 11.5"
		/>
	</svg>
)

export default Close
