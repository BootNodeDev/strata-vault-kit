import React from "react"

type IconProps = {
	className?: string
}

const Info: React.FC<IconProps> = ({ className }) => (
	<svg
		className={className}
		viewBox="0 0 15 15"
		fill="none"
		aria-hidden="true"
		focusable="false"
	>
		<path
			fill="currentColor"
			fillRule="evenodd"
			clipRule="evenodd"
			d="M7.5 1.25002C4.04822 1.25002 1.25002 4.04822 1.25002 7.5C1.25002 10.9518 4.04822 13.75 7.5 13.75C10.9518 13.75 13.75 10.9518 13.75 7.5C13.75 4.04822 10.9518 1.25002 7.5 1.25002ZM2.41669 7.5C2.41669 4.69255 4.69255 2.41669 7.5 2.41669C10.3075 2.41669 12.5834 4.69255 12.5834 7.5C12.5834 10.3075 10.3075 12.5834 7.5 12.5834C4.69255 12.5834 2.41669 10.3075 2.41669 7.5Z"
		/>
		<path
			fill="currentColor"
			fillRule="evenodd"
			clipRule="evenodd"
			d="M7.5 4.16669C7.17785 4.16669 6.91669 4.42785 6.91669 4.75002C6.91669 5.07219 7.17785 5.33335 7.5 5.33335C7.82219 5.33335 8.08335 5.07219 8.08335 4.75002C8.08335 4.42785 7.82219 4.16669 7.5 4.16669Z"
		/>
		<path
			fill="currentColor"
			fillRule="evenodd"
			clipRule="evenodd"
			d="M7.5 6.33335C7.82219 6.33335 8.08335 6.59452 8.08335 6.91669V10.4167C8.08335 10.7389 7.82219 11 7.5 11C7.17785 11 6.91669 10.7389 6.91669 10.4167V6.91669C6.91669 6.59452 7.17785 6.33335 7.5 6.33335Z"
		/>
	</svg>
)

export default Info
