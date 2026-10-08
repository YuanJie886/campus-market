package com.lulu.campusmarketbackend.admin;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.governance.StaffGuard;
import org.junit.jupiter.api.Test;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;

class AdminPermissionsTest {
    @Test void unknownRolesFailClosed() {
        assertThat(AdminPermissions.permissions("OWNER")).isEmpty();
    }
    @Test void auditorCannotMutateOrProcessCases() {
        assertThat(AdminPermissions.permissions("AUDITOR")).contains("audit:read", "users:read")
                .doesNotContain("users:write", "products:write", "cases:write", "cases:read", "appeals:write");
    }
    @Test void moderatorCannotGrantRoles() {
        assertThat(AdminPermissions.permissions("MODERATOR")).contains("cases:write").doesNotContain("users:write", "users:read");
    }
    @Test void revokedRoleIsCheckedOnEveryRequest() {
        String uid = UUID.randomUUID().toString();
        StaffGuard guard = new StaffGuard(null) {
            private int calls;
            @Override public Staff find(String ignored) {
                return calls++ == 0 ? new Staff(UUID.fromString(uid), "pilot", "SCHOOL_ADMIN") : null;
            }
        };
        AdminPermissions access = new AdminPermissions(guard);
        assertThat(access.require(uid, "users:write")).isNotNull();
        assertThatThrownBy(() -> access.require(uid, "users:write")).isInstanceOf(ApiException.class)
                .satisfies(error -> assertThat(((ApiException) error).status()).isEqualTo(403));
    }
}
