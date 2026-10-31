// Curated text-based lessons used to initialise an empty student workspace.
// These are learning materials, not recordings; no placeholder media or quiz history is created.
export const STARTER_LESSONS = [
  {
    title: "Operating Systems: CPU Scheduling",
    subject: "Computer Science",
    slides: [
      { title: "The role of an operating system", text: "An operating system manages hardware resources and provides applications with a consistent abstraction. The kernel coordinates CPU time, memory, storage, and input/output devices.", segments: [0, 1] },
      { title: "Processes and threads", text: "A process is a program in execution with its own address space and resources. Threads are execution paths inside a process; threads in one process share its address space.", segments: [2, 3] },
      { title: "CPU scheduling criteria", text: "Schedulers balance CPU utilisation, throughput, turnaround time, waiting time, and response time. Interactive systems place particular value on quick response.", segments: [4, 5] },
      { title: "Round-robin scheduling", text: "Round-robin scheduling gives each ready process a fixed time quantum. When the quantum expires, the scheduler preempts the process and places it at the end of the FIFO ready queue.", segments: [6, 7] },
      { title: "Context switching and quantum size", text: "A context switch saves the running process state and restores another process state. Very small time quanta increase switching overhead; very large quanta reduce responsiveness.", segments: [8, 9] }
    ],
    segments: [
      [0, 18, "An operating system manages the computer's hardware resources and provides a consistent environment for applications."],
      [18, 36, "The kernel coordinates CPU time, memory, storage, and input and output devices."],
      [36, 54, "A process is a program in execution, with its own address space and allocated resources."],
      [54, 72, "A thread is an execution path inside a process. Threads in the same process share its address space."],
      [72, 90, "CPU scheduling is judged using utilisation, throughput, turnaround time, waiting time, and response time."],
      [90, 108, "Interactive systems care strongly about response time, while batch systems often emphasise throughput and turnaround."],
      [108, 126, "Round-robin scheduling assigns each ready process a fixed time quantum before the scheduler preempts it."],
      [126, 144, "After preemption, the process moves to the end of the first-in, first-out ready queue."],
      [144, 162, "A context switch saves the current process state and restores the state of the next process."],
      [162, 180, "A very small quantum increases context-switch overhead, while a very large quantum can reduce responsiveness. Choosing a balanced quantum matters."]
    ],
    questions: [
      { slide: 0, segment: 0, question: "Which component coordinates CPU time, memory, storage, and device access?", options: ["Kernel", "Compiler", "Database index", "Browser engine"], answer: "Kernel", explanation: "The kernel coordinates core hardware resources for the operating system." },
      { slide: 1, segment: 2, question: "What best describes a process?", options: ["A program in execution", "A scheduling time slice", "A hardware interrupt", "A file-system directory"], answer: "A program in execution", explanation: "A process is an executing program with its own address space and resources." },
      { slide: 2, segment: 4, question: "Which scheduling criterion is especially important for interactive systems?", options: ["Response time", "Disk capacity", "Source-code length", "Page size"], answer: "Response time", explanation: "Interactive systems benefit from a quick response to user actions." },
      { slide: 3, segment: 6, question: "What happens when a round-robin process uses its full time quantum?", options: ["It is preempted", "It is deleted", "Its address space is erased", "The ready queue is cleared"], answer: "It is preempted", explanation: "Round-robin scheduling preempts the process when its time quantum expires." },
      { slide: 4, segment: 9, question: "What is a likely effect of choosing a very small time quantum?", options: ["More context-switch overhead", "No process can be interrupted", "The ready queue disappears", "All processes finish simultaneously"], answer: "More context-switch overhead", explanation: "A very small quantum causes more frequent switches between processes." }
    ]
  },
  {
    title: "Database Systems: Relational Model and SQL",
    subject: "Database Management Systems",
    slides: [
      { title: "Relational database structure", text: "A relational database organises information into tables. Rows represent records, columns represent attributes, and a schema describes the structure and constraints.", segments: [0, 1] },
      { title: "Primary and foreign keys", text: "A primary key uniquely identifies each row. A foreign key references a key in another table and helps maintain referential integrity between related records.", segments: [2, 3] },
      { title: "Filtering and grouping with SQL", text: "SELECT chooses columns, FROM identifies tables, and WHERE filters rows. GROUP BY creates groups for aggregate calculations such as COUNT, SUM, and AVG.", segments: [4, 5] },
      { title: "Joining related tables", text: "An INNER JOIN returns rows with matching join values. A LEFT JOIN keeps every row from the left table and adds matching values from the right table when available.", segments: [6, 7] },
      { title: "Normalisation", text: "Normalisation structures tables to reduce unnecessary repetition and update anomalies. First, second, and third normal forms apply progressively stronger rules to dependencies and table structure.", segments: [8, 9] }
    ],
    segments: [
      [0, 16, "A relational database stores structured information in tables that describe one kind of entity or relationship."],
      [16, 32, "Rows represent individual records, columns represent attributes, and the schema defines the table structure and constraints."],
      [32, 48, "A primary key uniquely identifies each row in a table and should not be duplicated."],
      [48, 64, "A foreign key references a key in another table and connects related records while supporting referential integrity."],
      [64, 80, "SQL uses SELECT to choose columns, FROM to identify tables, and WHERE to filter rows."],
      [80, 96, "GROUP BY organises rows into groups so aggregate functions such as COUNT, SUM, and AVG can calculate summaries."],
      [96, 112, "An INNER JOIN returns rows when the join condition finds matching values in both tables."],
      [112, 128, "A LEFT JOIN preserves every row from the left table and includes matching right-table values when they exist."],
      [128, 144, "Normalisation organises relational tables to reduce repeated data and prevent insertion, update, and deletion anomalies."],
      [144, 160, "First, second, and third normal forms address progressively stronger rules about atomic values, partial dependencies, and transitive dependencies."]
    ],
    questions: [
      { slide: 0, segment: 1, question: "In a relational table, what does a row represent?", options: ["A record", "An attribute", "A database schema", "A join condition"], answer: "A record", explanation: "Each row stores one record; columns describe its attributes." },
      { slide: 1, segment: 2, question: "What is the main purpose of a primary key?", options: ["Uniquely identify a row", "Sort every query result", "Encrypt a table", "Combine two databases"], answer: "Uniquely identify a row", explanation: "A primary key uniquely identifies each record in its table." },
      { slide: 2, segment: 4, question: "Which SQL clause filters rows?", options: ["WHERE", "ORDER BY", "GROUP BY", "SELECT"], answer: "WHERE", explanation: "WHERE applies a condition to determine which rows are returned." },
      { slide: 3, segment: 6, question: "Which join returns only rows with matching values on both sides?", options: ["INNER JOIN", "LEFT JOIN", "CROSS JOIN", "FULL OUTER JOIN"], answer: "INNER JOIN", explanation: "INNER JOIN returns records that satisfy the join condition in both tables." },
      { slide: 4, segment: 8, question: "What is a central goal of database normalisation?", options: ["Reduce data redundancy", "Increase duplicate records", "Remove all foreign keys", "Avoid using tables"], answer: "Reduce data redundancy", explanation: "Normalisation reduces unnecessary repetition and helps prevent update anomalies." }
    ]
  },
  {
    title: "JavaScript: Asynchronous Programming",
    subject: "Web Development",
    slides: [
      { title: "The JavaScript call stack", text: "JavaScript executes function calls using a call stack. Synchronous work runs in order, while asynchronous APIs schedule callbacks or promise reactions for later execution.", segments: [0, 1] },
      { title: "The event loop", text: "The event loop coordinates the call stack and task queues. It allows JavaScript to handle asynchronous work without blocking the main thread while waiting for results.", segments: [2, 3] },
      { title: "Promises", text: "A Promise represents the eventual result of an asynchronous operation. It can be pending, fulfilled, or rejected, and handlers are attached with then and catch.", segments: [4, 5] },
      { title: "Async and await", text: "An async function always returns a Promise. The await expression pauses that function until a Promise settles, making asynchronous control flow easier to read.", segments: [6, 7] },
      { title: "Handling failures", text: "try and catch handle rejected asynchronous operations when used with await. finally runs cleanup code whether the operation succeeds or fails.", segments: [8, 9] }
    ],
    segments: [
      [0, 15, "JavaScript uses a call stack to keep track of the function that is currently executing."],
      [15, 30, "Synchronous statements execute in order, while asynchronous operations arrange for later work through callbacks or promises."],
      [30, 45, "The event loop coordinates the call stack with queues of work that is ready to run."],
      [45, 60, "When the call stack is clear, the event loop allows queued callbacks and promise reactions to run."],
      [60, 75, "A Promise represents the eventual result of an asynchronous operation and can be pending, fulfilled, or rejected."],
      [75, 90, "The then method handles fulfillment, while catch handles rejection and provides a place to recover from errors."],
      [90, 105, "An async function always returns a Promise, even when its return value is an ordinary value."],
      [105, 120, "The await expression pauses the surrounding async function until the awaited Promise settles, then continues with its result."],
      [120, 135, "A try and catch block can handle a rejected Promise when the operation is awaited inside the try block."],
      [135, 150, "A finally block runs after either success or failure and is useful for cleanup such as releasing a loading state."]
    ],
    questions: [
      { slide: 0, segment: 0, question: "What does the JavaScript call stack track?", options: ["Currently executing function calls", "All files in a project", "Browser history entries", "CSS selector priority"], answer: "Currently executing function calls", explanation: "The call stack tracks the active sequence of function calls." },
      { slide: 1, segment: 2, question: "What does the event loop coordinate?", options: ["The call stack and queued work", "HTML and CSS files only", "Database tables and indexes", "Variables and function names"], answer: "The call stack and queued work", explanation: "The event loop coordinates the stack with callbacks and promise reactions waiting to run." },
      { slide: 2, segment: 4, question: "Which states can a Promise have?", options: ["Pending, fulfilled, rejected", "Open, closed, paused", "Started, stopped, deleted", "Loaded, cached, rendered"], answer: "Pending, fulfilled, rejected", explanation: "A Promise begins pending and eventually becomes fulfilled or rejected." },
      { slide: 3, segment: 6, question: "What does an async function return?", options: ["A Promise", "A DOM element", "A CSS rule", "A file handle"], answer: "A Promise", explanation: "An async function wraps its result in a Promise." },
      { slide: 4, segment: 8, question: "Which block is useful for cleanup after either success or failure?", options: ["finally", "switch", "for", "case"], answer: "finally", explanation: "The finally block runs after the try/catch flow regardless of whether it succeeds or fails." }
    ]
  }
];
