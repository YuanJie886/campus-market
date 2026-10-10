package com.lulu.campusmarketbackend.service;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Historical order cleanup is retained for audit tooling and is no longer scheduled. */
@Component
@ConditionalOnProperty(name = "campus-market.expiry-job-enabled", havingValue = "true", matchIfMissing = true)
public class OrderExpiryJob {

    private final OrderTransitionExecutor transitions;

    public OrderExpiryJob(OrderTransitionExecutor transitions) {
        this.transitions = transitions;
    }

    public void sweepExpiredOrders() {
        transitions.sweepExpired();
    }
}
