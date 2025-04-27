export const functionCalls = {
	tillDate: {
		name: 'tillDate',
		description:
			'Returns the difference in days between today and the given date.',
		callBack: arr => {
			const today = new Date();
			const yyyy = today.getFullYear();
			let mm = today.getMonth() + 1; // Months start at 0!
			let dd = today.getDate();

			let date1 = new Date(`$${mm}/${dd},${yyyy}`);
			let date2 = new Date(`${arr[0]}/${arr[1]}/${arr[2]}`);

			let Difference_In_Time = date2.getTime() - date1.getTime();
			let Difference_In_Days = Difference_In_Time / (1000 * 3600 * 24);

			return Difference_In_Days < 0
				? Math.round(Difference_In_Days) * -1
				: Math.round(Difference_In_Days);
		},
	},
	todayDate: {
		name: 'todayDate',
		description: 'Returns todays date.',
		callBack: () => {
			return new Date()
				.toISOString()
				.slice(0, 10)
				.split('-')
				.reverse()
				.join('/');
		},
	},
};

export default {
	functionCalls,
};
