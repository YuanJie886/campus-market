package com.lulu.campusmarketbackend;

import com.lulu.campusmarketbackend.service.OrderExpiryJob;
import com.lulu.campusmarketbackend.service.OrderService;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.annotation.Scheduled;
import java.util.Arrays;
import static org.assertj.core.api.Assertions.assertThat;

/** Historical orders are retained, but the display-only platform must not schedule trade transitions. */
class OrderExpiryJobConfigurationTest {
    @Test void historicalOrdersHaveNoScheduledEntryPoint() {
        for (Class<?> type : new Class<?>[]{OrderExpiryJob.class, OrderService.class}) {
            assertThat(Arrays.stream(type.getDeclaredMethods()).filter(m -> m.isAnnotationPresent(Scheduled.class)).count())
                .as("%s must not schedule historical trade transitions", type.getSimpleName()).isZero();
        }
    }
}
