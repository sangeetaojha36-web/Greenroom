import fs from 'fs';
import path from 'path';

const BANK_PATH = path.resolve('data/question_bank.json');
const raw = fs.readFileSync(BANK_PATH, 'utf8');
const data = JSON.parse(raw);

// Role-specific supplemental genuine questions for Junior and Senior levels
const SUPPLEMENTAL_QUESTIONS = {
  "Software Engineer": {
    junior: [
      {
        q: "Explain how a HashMap works under the hood. What happens during a hash collision and how do different languages resolve it?",
        keywords: ["hash function", "bucket", "collision", "linked list", "red-black tree", "load factor", "o(1)"],
        type: "technical"
      },
      {
        q: "Compare an Array with a Linked List. In what scenarios would you choose one over the other based on memory allocation and time complexity?",
        keywords: ["contiguous memory", "cache locality", "dynamic size", "index access", "insertion", "pointer overhead"],
        type: "technical"
      },
      {
        q: "What is the difference between a Process and a Thread? How do they share or isolate CPU and memory resources?",
        keywords: ["address space", "stack", "heap", "context switch", "shared memory", "thread safety"],
        type: "technical"
      },
      {
        q: "What is Big-O notation, and how do you calculate the time and space complexity of a recursive algorithm like Merge Sort?",
        keywords: ["big-o", "time complexity", "space complexity", "recursion tree", "divide and conquer", "o(n log n)"],
        type: "technical"
      },
      {
        q: "Explain the four core principles of Object-Oriented Programming (OOP) with a concrete real-world software example.",
        keywords: ["encapsulation", "abstraction", "inheritance", "polymorphism", "interface", "method overriding"],
        type: "technical"
      },
      {
        q: "What is the difference between Stack memory and Heap memory in application runtimes? How does garbage collection interact with them?",
        keywords: ["stack frame", "heap allocation", "garbage collection", "memory leak", "lifo", "reference"],
        type: "technical"
      }
    ],
    senior: [
      {
        q: "Design a globally distributed rate limiter that handles 500,000 requests per second across multiple AWS/GCP regions with minimal latency.",
        keywords: ["token bucket", "sliding window", "redis cluster", "eventual consistency", "edge proxy", "clock skew"],
        type: "system_design"
      },
      {
        q: "How would you architect a zero-downtime database migration when splitting a 10TB monolithic PostgreSQL database into sharded microservices?",
        keywords: ["dual write", "change data capture", "debezium", "shadow traffic", "canary migration", "reconciliation"],
        type: "system_design"
      },
      {
        q: "Explain the CAP theorem, PACELC theorem, and how you would choose between strong consistency (Raft/Paxos) and eventual consistency in a financial vs social app.",
        keywords: ["cap theorem", "pacelc", "linearizability", "raft", "paxos", "quorum", "eventual consistency", "latency trade-off"],
        type: "technical"
      },
      {
        q: "Design a fault-tolerant, horizontally scalable notification engine (Email, SMS, Push) processing 50 million notifications daily with idempotency and priority queues.",
        keywords: ["message queue", "kafka", "rabbitmq", "idempotency key", "dead letter queue", "rate limit per provider", "backpressure"],
        type: "system_design"
      },
      {
        q: "How do you detect, mitigate, and architect against cascading failures and thundering herd problems in microservice dependency graphs?",
        keywords: ["circuit breaker", "exponential backoff", "jitter", "load shedding", "bulkhead", "graceful degradation", "health checks"],
        type: "technical"
      }
    ]
  },
  "Data Analyst": {
    junior: [
      {
        q: "Explain the difference between INNER JOIN, LEFT JOIN, RIGHT JOIN, and FULL OUTER JOIN with an illustrative business query.",
        keywords: ["inner join", "left join", "null values", "primary key", "foreign key", "cardinality"],
        type: "technical"
      },
      {
        q: "What is the difference between the WHERE clause and the HAVING clause in SQL?",
        keywords: ["where", "having", "group by", "aggregate function", "filter before aggregation"],
        type: "technical"
      },
      {
        q: "How do you detect and handle missing data or null values before calculating critical summary metrics?",
        keywords: ["imputation", "mean", "median", "drop nulls", "bias", "data completeness"],
        type: "technical"
      }
    ],
    senior: [
      {
        q: "How would you design a company-wide North Star metric and metric hierarchy that balances user acquisition, monetization, and churn risk?",
        keywords: ["north star metric", "leading indicator", "lagging indicator", "counter metric", "cannibalization", "cohort retention"],
        type: "technical"
      },
      {
        q: "Two critical executive dashboards report contradictory revenue figures for the same fiscal quarter. How do you lead the data reconciliation effort across business units?",
        keywords: ["data governance", "single source of truth", "dbt", "data lineage", "business definition alignment", "audit trail"],
        type: "technical"
      }
    ]
  },
  "Data Scientist": {
    junior: [
      {
        q: "Explain the Bias-Variance tradeoff. How do underfitting and overfitting manifest, and how do you diagnose them on train vs validation loss curves?",
        keywords: ["bias", "variance", "overfitting", "underfitting", "regularization", "cross-validation", "validation curve"],
        type: "technical"
      },
      {
        q: "When would you prefer using the ROC-AUC score over standard Accuracy or F1-Score in evaluating a machine learning model?",
        keywords: ["roc-auc", "class imbalance", "threshold independent", "true positive rate", "false positive rate"],
        type: "technical"
      }
    ],
    senior: [
      {
        q: "Design an end-to-end real-time recommendation architecture that serves personalized rankings in under 20 milliseconds under peak traffic.",
        keywords: ["candidate generation", "vector search", "faiss", "two-tower model", "feature store", "feast", "caching", "cold start"],
        type: "system_design"
      },
      {
        q: "How do you establish continuous model monitoring, automated retraining pipelines, and canary rollouts to safeguard against concept drift in production ML?",
        keywords: ["concept drift", "covariate shift", "evidently ai", "shadow model", "canary deployment", "kl divergence", "ground truth latency"],
        type: "technical"
      }
    ]
  },
  "DevOps Engineer": {
    junior: [
      {
        q: "Explain the difference between a Virtual Machine (VM) and a Docker Container in terms of kernel sharing, resource overhead, and isolation.",
        keywords: ["hypervisor", "guest os", "container engine", "cgroups", "namespaces", "startup latency", "kernel"],
        type: "technical"
      },
      {
        q: "What is the purpose of Git rebase versus Git merge? When should you avoid rebasing shared branches?",
        keywords: ["git rebase", "git merge", "commit history", "linear history", "fast-forward", "shared branch"],
        type: "technical"
      }
    ],
    senior: [
      {
        q: "Design a multi-region active-active cloud architecture on AWS/GCP with automated DNS failover, zero-data loss RPO, and sub-minute RTO.",
        keywords: ["active-active", "rpo", "rto", "route53", "global accelerator", "cross-region replication", "split-brain prevention"],
        type: "system_design"
      },
      {
        q: "How do you implement progressive delivery (canary deployments, blue-green, feature flags) with automated metric-based rollback in Kubernetes using Argo Rollouts or Flagger?",
        keywords: ["canary", "blue green", "argo rollouts", "prometheus metrics", "automated rollback", "traffic shifting", "service mesh"],
        type: "technical"
      }
    ]
  },
  "Product Manager": {
    junior: [
      {
        q: "How do you write a clear User Story and define Acceptance Criteria for an engineering team?",
        keywords: ["user story", "as a user", "acceptance criteria", "edge cases", "definition of done", "user persona"],
        type: "technical"
      },
      {
        q: "How would you prioritize a backlog of 20 feature requests using the RICE (Reach, Impact, Confidence, Effort) scoring framework?",
        keywords: ["reach", "impact", "confidence", "effort", "rice framework", "prioritization matrix"],
        type: "technical"
      }
    ],
    senior: [
      {
        q: "Your product's growth has plateaued after reaching $50M ARR. Walk through your multi-year strategy to unlock the next curve of enterprise growth.",
        keywords: ["market expansion", "product-led growth", "enterprise tiers", "adjacent markets", "tam", "churn reduction", "platform strategy"],
        type: "technical"
      },
      {
        q: "How do you manage a high-friction misalignment between the VP of Sales (demanding custom enterprise features) and the Head of Engineering (advocating for tech debt reduction)?",
        keywords: ["stakeholder management", "business value", "trade-offs", "tech debt allocation", "strategic roadmap", "compromise"],
        type: "behavioral"
      }
    ]
  },
  "QA Engineer": {
    junior: [
      {
        q: "Explain Equivalence Partitioning and Boundary Value Analysis with a concrete input field test scenario.",
        keywords: ["boundary value analysis", "equivalence partitioning", "test cases", "off-by-one", "edge cases"],
        type: "technical"
      },
      {
        q: "What is the difference between Smoke Testing, Sanity Testing, and Full Regression Testing in release cycles?",
        keywords: ["smoke test", "sanity test", "regression test", "build verification", "release pipeline"],
        type: "technical"
      }
    ],
    senior: [
      {
        q: "How do you architect an enterprise CI/CD test automation framework that runs 5,000 end-to-end tests in under 10 minutes with zero flakiness?",
        keywords: ["parallel execution", "test sharding", "flakiness detection", "dockerized runners", "playwright grid", "test quarantine"],
        type: "technical"
      },
      {
        q: "How do you introduce Chaos Engineering and shift-left quality practices into an organization with legacy manual testing habits?",
        keywords: ["chaos engineering", "fault injection", "shift left", "sla/slo testing", "developer ownership", "cultural transition"],
        type: "technical"
      }
    ]
  }
};

// Classify existing questions with precision
function classifyQuestion(q) {
  if (q.level) return q.level;
  const text = (q.q + ' ' + (q.keywords || []).join(' ')).toLowerCase();

  // Senior signals
  if (
    q.type === 'system_design' ||
    text.includes('distributed') ||
    text.includes('sharding') ||
    text.includes('replication') ||
    text.includes('high availability') ||
    text.includes('cap theorem') ||
    text.includes('pacelc') ||
    text.includes('paxos') ||
    text.includes('raft') ||
    text.includes('millions of users') ||
    text.includes('millions of requests') ||
    text.includes('billions of') ||
    text.includes('architect') ||
    text.includes('architecture') ||
    text.includes('fault-tolerant') ||
    text.includes('load balancer') ||
    text.includes('microservices') ||
    text.includes('rate limiter') ||
    text.includes('web crawler') ||
    text.includes('url shortener') ||
    text.includes('chat application') ||
    text.includes('strategic') ||
    text.includes('vision') ||
    text.includes('technical debt') ||
    text.includes('high-stakes') ||
    text.includes('multi-tenant') ||
    text.includes('zero-downtime') ||
    text.includes('cascading failure') ||
    text.includes('thundering herd')
  ) {
    return 'senior';
  }

  // Junior signals
  if (
    text.includes('what happens when you type a url') ||
    text.includes('difference between get and post') ||
    text.includes('http vs https') ||
    text.includes('oop') ||
    text.includes('inheritance') ||
    text.includes('polymorphism') ||
    text.includes('array') ||
    text.includes('linked list') ||
    text.includes('binary search') ||
    text.includes('hashmap') ||
    text.includes('stack vs queue') ||
    text.includes('basic') ||
    text.includes('junior') ||
    text.includes('entry') ||
    text.includes('type i and type ii') ||
    text.includes('precision, recall') ||
    text.includes('3-5 years') ||
    text.includes('why should we hire you') ||
    text.includes('weakness') ||
    text.includes('college') ||
    text.includes('intern') ||
    text.includes('introduction') ||
    text.includes('syntax') ||
    text.includes('sql join') ||
    text.includes('inner join') ||
    text.includes('what is a class') ||
    text.includes('overfitting') ||
    text.includes('underfitting') ||
    text.includes('bias-variance') ||
    text.includes('user story')
  ) {
    return 'junior';
  }

  return 'mid';
}

// Process companies
let totalAdded = 0;
data.companies.forEach(company => {
  // Classify existing role questions
  for (const role in company.roles || {}) {
    company.roles[role].forEach(q => {
      q.level = classifyQuestion(q);
      q.genuine = true;
    });

    // Check count for junior and senior
    const existingJunior = company.roles[role].filter(q => q.level === 'junior');
    const existingSenior = company.roles[role].filter(q => q.level === 'senior');

    const roleSupp = SUPPLEMENTAL_QUESTIONS[role] || SUPPLEMENTAL_QUESTIONS["Software Engineer"];

    // Ensure at least 4 junior questions
    if (existingJunior.length < 4 && roleSupp?.junior) {
      roleSupp.junior.forEach((supp, idx) => {
        if (!company.roles[role].some(existing => existing.q.includes(supp.q.slice(0, 25)))) {
          company.roles[role].push({
            id: `${company.id}_${role.toLowerCase().replace(/\s+/g, '')}_jr_${idx + 1}`,
            level: 'junior',
            genuine: true,
            ...supp
          });
          totalAdded++;
        }
      });
    }

    // Ensure at least 4 senior questions
    if (existingSenior.length < 4 && roleSupp?.senior) {
      roleSupp.senior.forEach((supp, idx) => {
        if (!company.roles[role].some(existing => existing.q.includes(supp.q.slice(0, 25)))) {
          company.roles[role].push({
            id: `${company.id}_${role.toLowerCase().replace(/\s+/g, '')}_sr_${idx + 1}`,
            level: 'senior',
            genuine: true,
            ...supp
          });
          totalAdded++;
        }
      });
    }
  }

  // Tag behavioral questions with levels
  (company.behavioral || []).forEach(q => {
    const text = q.q.toLowerCase();
    if (text.includes('executive') || text.includes('high-stakes') || text.includes('mentor') || text.includes('vision') || text.includes('cross-team') || text.includes('architectural')) {
      q.level = 'senior';
    } else if (text.includes('feedback') || text.includes('criticism') || text.includes('first') || text.includes('learn a completely new') || text.includes('challenge')) {
      q.level = 'junior';
    } else {
      q.level = 'mid';
    }
    q.genuine = true;
  });

  // Tag HR questions with levels
  (company.hr || []).forEach(q => {
    const text = q.q.toLowerCase();
    if (text.includes('culture') || text.includes('organization') || text.includes('excellence') || text.includes('build versus buy')) {
      q.level = 'senior';
    } else if (text.includes('3-5 years') || text.includes('start your career') || text.includes('learn') || text.includes('weakness')) {
      q.level = 'junior';
    } else {
      q.level = 'mid';
    }
    q.genuine = true;
  });
});

fs.writeFileSync(BANK_PATH, JSON.stringify(data, null, 2), 'utf8');
console.log(`Successfully enriched question bank. Added ${totalAdded} genuine targeted questions.`);
